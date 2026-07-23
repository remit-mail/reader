import {
	mailboxOperationsListMailboxesQueryKey,
	threadOperationsListThreadsQueryKey,
	threadOperationsSearchThreadsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	messageBulkOperationsDeleteMessages,
	messageBulkOperationsMoveMessages,
	messageBulkOperationsUpdateFlags,
	threadOperationsSearchThreads,
} from "@remit/api-http-client/sdk.gen.ts";
import type { ThreadOperationsSearchThreadsData } from "@remit/api-http-client/types.gen.ts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { buildMutationErrorBanner } from "@/components/ui/error-banners";
import {
	bulkActionFailureDetail,
	bulkActionFailureTitle,
} from "@/lib/bulk-action-copy";
import {
	type ApplyBatch,
	type BulkActionProgress,
	type BulkRunOutcome,
	countMatches,
	type FetchIdsPage,
	honestProgress,
	runChunkedAction,
	runPredicateAction,
} from "@/lib/bulk-actions";

/** The predicate a search-scoped run re-issues on every page — the same
 *  filters the visible list is searching with, minus pagination/count knobs. */
export type EscalationSearchQuery = Pick<
	NonNullable<ThreadOperationsSearchThreadsData["query"]>,
	"order" | "query" | "subject" | "from" | "unread" | "starred" | "attachments"
>;

/**
 * What a bulk run applies to every batch it reaches (#114). Delete, move and
 * mark-read differ only in the bulk call they issue and the caches that call
 * invalidates; the paging, chunking, progress and cancellation are the same.
 */
export type EscalatedAction =
	| { kind: "delete" }
	| { kind: "move"; destinationMailboxId: string }
	| { kind: "markRead" };

/** Page size for both the counting and the execution loop. Set to the write
 *  side's own 100-id cap so an execution page IS a write chunk — no
 *  in-memory accumulation step between reading ids and sending them. Counting
 *  doesn't have that constraint but reuses the same page size rather than
 *  adding a second one to reason about. */
const PAGE_SIZE = 100;

export type EscalationPhase =
	| { kind: "idle" }
	| { kind: "counting"; countSoFar: number }
	| { kind: "escalated"; total: number };

interface UseEscalatedActionsOptions {
	mailboxId: string;
	/** Owning account, forwarded to the unseen-count invalidation on completion. */
	accountId?: string;
	/** Disables escalation entirely (e.g. not searching, or desktop — this is a
	 *  mobile-only affordance). Resets any in-flight phase back to idle. */
	enabled: boolean;
	/** Identifies the active predicate; escalation resets to idle whenever this
	 *  changes (a different search is a different question). */
	predicateKey: string;
	searchQuery: EscalationSearchQuery;
}

export interface UseEscalatedActionsResult {
	phase: EscalationPhase;
	/** Begin paging the predicate's full match set to find its total. */
	escalate: () => void;
	/** Stop whatever's running — counting or an action — at the next page
	 *  boundary. A no-op when nothing is running. */
	stop: () => void;
	/** Drop an escalated selection back to bounded without confirming anything. */
	clear: () => void;
	/** True while a chunked run (bounded->100 ids, or the escalated predicate)
	 *  is in flight. */
	isRunning: boolean;
	/** The action currently in flight, for status and progress wording. */
	runningAction: EscalatedAction | undefined;
	progress: BulkActionProgress | undefined;
	/**
	 * Runs `action` in chunks. Pass `ids` for a materialized (bounded)
	 * selection; omit it to run against the escalated predicate (`phase` must
	 * be "escalated"). Resolves once the run ends for any reason — cancelled,
	 * errored, or complete — with a `done`/`failedIds` outcome the caller feeds
	 * to `resolveSelectionAfterRun` to decide what selection looks like next.
	 * Infrastructure failures are reported through the app's existing
	 * escalation seam (`pushError`, which itself escalates a 5xx/exception to
	 * the fatal overlay) — not swallowed here.
	 */
	runAction: (
		action: EscalatedAction,
		ids?: string[],
	) => Promise<BulkRunOutcome>;
}

export const useEscalatedActions = ({
	mailboxId,
	accountId,
	enabled,
	predicateKey,
	searchQuery,
}: UseEscalatedActionsOptions): UseEscalatedActionsResult => {
	const [phase, setPhase] = useState<EscalationPhase>({ kind: "idle" });
	const [runningAction, setRunningAction] = useState<
		EscalatedAction | undefined
	>(undefined);
	const [progress, setProgress] = useState<BulkActionProgress | undefined>(
		undefined,
	);
	const cancelRef = useRef(false);
	const queryClient = useQueryClient();
	const { pushError } = useErrorBanners();

	// A different search (or leaving search/desktop) makes any in-flight
	// escalation meaningless — it would otherwise keep counting or offering to
	// act on a predicate the visible list no longer reflects.
	// biome-ignore lint/correctness/useExhaustiveDependencies: enabled/predicateKey are trigger-only — the reset itself is unconditional, not a value read from either.
	useEffect(() => {
		cancelRef.current = true;
		setPhase({ kind: "idle" });
	}, [enabled, predicateKey]);

	const searchQueryRef = useRef(searchQuery);
	searchQueryRef.current = searchQuery;

	const fetchIdsPage = useCallback<FetchIdsPage>(
		async (continuationToken) => {
			const { data } = await threadOperationsSearchThreads({
				path: { mailboxId },
				query: {
					...searchQueryRef.current,
					continuationToken,
					limit: PAGE_SIZE,
				},
				throwOnError: true,
			});
			return {
				ids: (data.items ?? []).map((item) => item.messageId),
				continuationToken: data.continuationToken,
			};
		},
		[mailboxId],
	);

	const applyBatchFor = useCallback(
		(action: EscalatedAction): ApplyBatch =>
			async (ids: string[]) => {
				if (action.kind === "move") {
					const { data } = await messageBulkOperationsMoveMessages({
						body: {
							messageIds: ids,
							destinationMailboxId: action.destinationMailboxId,
						},
						throwOnError: true,
					});
					return data;
				}
				if (action.kind === "markRead") {
					const { data } = await messageBulkOperationsUpdateFlags({
						body: { messageIds: ids, isRead: true },
						throwOnError: true,
					});
					return data;
				}
				const { data } = await messageBulkOperationsDeleteMessages({
					body: { messageIds: ids },
					throwOnError: true,
				});
				return data;
			},
		[],
	);

	const invalidateAfterRun = useCallback(
		(action: EscalatedAction) => {
			queryClient.invalidateQueries({
				queryKey: threadOperationsListThreadsQueryKey({ path: { mailboxId } }),
			});
			queryClient.invalidateQueries({
				queryKey: threadOperationsSearchThreadsQueryKey({
					path: { mailboxId },
				}),
			});
			if (action.kind === "move") {
				queryClient.invalidateQueries({
					queryKey: threadOperationsListThreadsQueryKey({
						path: { mailboxId: action.destinationMailboxId },
					}),
				});
			}
			if (accountId) {
				queryClient.invalidateQueries({
					queryKey: mailboxOperationsListMailboxesQueryKey({
						path: { accountId },
					}),
				});
			}
		},
		[queryClient, mailboxId, accountId],
	);

	const escalate = useCallback(() => {
		cancelRef.current = false;
		setPhase({ kind: "counting", countSoFar: 0 });
		countMatches(
			fetchIdsPage,
			(countSoFar) => setPhase({ kind: "counting", countSoFar }),
			() => cancelRef.current,
		).then((result) => {
			if (result.error) {
				pushError(
					buildMutationErrorBanner(
						"Couldn't count matching messages",
						"The count didn't finish.",
						result.error,
					),
				);
				setPhase({ kind: "idle" });
				return;
			}
			if (result.cancelled) {
				setPhase({ kind: "idle" });
				return;
			}
			setPhase({ kind: "escalated", total: result.total });
		});
	}, [fetchIdsPage, pushError]);

	const stop = useCallback(() => {
		cancelRef.current = true;
	}, []);

	const clear = useCallback(() => {
		cancelRef.current = true;
		setPhase({ kind: "idle" });
	}, []);

	const runAction = useCallback(
		async (
			action: EscalatedAction,
			ids?: string[],
		): Promise<BulkRunOutcome> => {
			cancelRef.current = false;
			setRunningAction(action);
			// `honestProgress` widens `total` if `done` overtakes it (#109) — the
			// predicate can match more by the time the run re-pages it than
			// `countMatches` saw, and the bar must never show more done than out of.
			const onProgress = (next: BulkActionProgress) =>
				setProgress(honestProgress(next));
			const applyBatch = applyBatchFor(action);

			const outcome =
				ids !== undefined
					? await runChunkedAction(
							ids,
							applyBatch,
							onProgress,
							() => cancelRef.current,
						)
					: await runPredicateAction(
							fetchIdsPage,
							phase.kind === "escalated" ? phase.total : 0,
							applyBatch,
							onProgress,
							() => cancelRef.current,
						);

			setRunningAction(undefined);
			setProgress(undefined);
			setPhase({ kind: "idle" });

			if (outcome.error) {
				pushError(
					buildMutationErrorBanner(
						bulkActionFailureTitle(action.kind, outcome.done),
						bulkActionFailureDetail(action.kind),
						outcome.error,
					),
				);
			}
			if (outcome.done > 0) {
				invalidateAfterRun(action);
			}
			return outcome;
		},
		[applyBatchFor, fetchIdsPage, phase, pushError, invalidateAfterRun],
	);

	return {
		phase,
		escalate,
		stop,
		clear,
		isRunning: runningAction !== undefined,
		runningAction,
		progress,
		runAction,
	};
};
