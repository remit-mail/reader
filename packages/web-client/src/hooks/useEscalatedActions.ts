import { mailboxOperationsListMailboxesQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
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
	type BulkActionTarget,
	type BulkRunOutcome,
	type FetchIdsPage,
	honestProgress,
	runChunkedAction,
	runPredicateAction,
} from "@/lib/bulk-actions";
import {
	invalidateThreadListQueries,
	threadListCacheKeys,
} from "@/lib/thread-list-cache";

/** The predicate a search-scoped run re-issues on every page — the same
 *  filters the visible list is searching with, minus pagination/count knobs. */
export type EscalationSearchQuery = Pick<
	NonNullable<ThreadOperationsSearchThreadsData["query"]>,
	| "order"
	| "query"
	| "subject"
	| "from"
	| "unread"
	| "starred"
	| "attachments"
	| "category"
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

/** Page size for the execution loop. Set to the write side's own 100-id cap so
 *  an execution page IS a write chunk — no in-memory accumulation step between
 *  reading ids and sending them. */
const PAGE_SIZE = 100;

export type EscalationPhase =
	| { kind: "idle" }
	| { kind: "counting" }
	| { kind: "escalated"; total: number };

interface UseEscalatedActionsOptions {
	mailboxId: string;
	/** Owning account, forwarded to the unseen-count invalidation on completion. */
	accountId?: string;
	/** Disables escalation entirely (e.g. not searching). Resets any in-flight
	 *  phase back to idle. */
	enabled: boolean;
	/** Identifies the active predicate; escalation resets to idle whenever this
	 *  changes (a different search is a different question). */
	predicateKey: string;
	searchQuery: EscalationSearchQuery;
}

export interface UseEscalatedActionsResult {
	phase: EscalationPhase;
	/** Ask the server how many messages the predicate matches, and switch the
	 *  selection to that predicate once it answers. */
	escalate: () => void;
	/**
	 * Stop whatever's running — the count or an action — at the next boundary.
	 * A no-op when nothing is running. The only thing that ends a run in
	 * flight: leaving the selection, the wizard or the search does not.
	 */
	stop: () => void;
	/**
	 * Drop an escalated selection back to bounded without confirming anything.
	 * A run in flight owns the phase and holds it until it ends, so this is a
	 * no-op then — the selection the user is leaving and the run they started
	 * from it are two different things.
	 */
	clear: () => void;
	/** True while a chunked run (bounded->100 ids, or the escalated predicate)
	 *  is in flight. */
	isRunning: boolean;
	/** The action currently in flight, for status and progress wording. */
	runningAction: EscalatedAction | undefined;
	progress: BulkActionProgress | undefined;
	/**
	 * Runs `action` in chunks. Pass `targets` for a materialized (bounded)
	 * selection; omit them to run against the escalated predicate (`phase` must
	 * be "escalated"). Each target names the account that owns it, so a
	 * selection spanning accounts is sent as one batch per account rather than
	 * as one batch the endpoint refuses whole (#872). Resolves once the run ends
	 * for any reason — cancelled, errored, or complete — with a
	 * `done`/`failedIds` outcome the caller reads to decide what is still
	 * outstanding.
	 * Infrastructure failures are reported through the app's existing
	 * escalation seam (`pushError`, which itself escalates a 5xx/exception to
	 * the fatal overlay) — not swallowed here.
	 */
	runAction: (
		action: EscalatedAction,
		targets?: readonly BulkActionTarget[],
	) => Promise<BulkRunOutcome>;
}

/**
 * The mailboxes whose cached listings a bulk run affects: the mailbox it ran
 * over, plus a move's destination, which gains the messages the source loses.
 */
export const mailboxesTouchedBy = (
	action: EscalatedAction,
	mailboxId: string,
): string[] =>
	action.kind === "move"
		? [mailboxId, action.destinationMailboxId]
		: [mailboxId];

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
	// True from the moment a run starts until its outcome is in hand. A run is
	// mail already leaving the mailbox, so nothing that merely changes what the
	// list is showing gets to end it — only `stop`.
	const runningRef = useRef(false);
	const queryClient = useQueryClient();
	const { pushError } = useErrorBanners();

	// A different search (or leaving search/desktop) makes any in-flight
	// escalation meaningless — it would otherwise keep counting or offering to
	// act on a predicate the visible list no longer reflects. The selection goes;
	// a run already going does not. It pages the predicate it was started
	// against and reports what it reached, wherever the list moved on to.
	// biome-ignore lint/correctness/useExhaustiveDependencies: enabled/predicateKey are trigger-only — the reset itself reads neither.
	useEffect(() => {
		if (!runningRef.current) cancelRef.current = true;
		setPhase({ kind: "idle" });
	}, [enabled, predicateKey]);

	const searchQueryRef = useRef(searchQuery);
	searchQueryRef.current = searchQuery;

	const fetchPagesOf = useCallback(
		(query: EscalationSearchQuery): FetchIdsPage =>
			async (continuationToken) => {
				const { data } = await threadOperationsSearchThreads({
					path: { mailboxId },
					query: { ...query, continuationToken, limit: PAGE_SIZE },
					throwOnError: true,
				});
				return {
					ids: (data.items ?? []).map((item) => item.messageId),
					continuationToken: data.continuationToken,
				};
			},
		[mailboxId],
	);

	/**
	 * How many messages the predicate matches, straight from the server that
	 * resolves it (#509). One count-only request: `limit` is a page size and has
	 * no bearing on the answer, so nothing is paged to arrive at it.
	 */
	const fetchMatchCount = useCallback(async (): Promise<number> => {
		const { data } = await threadOperationsSearchThreads({
			path: { mailboxId },
			query: { ...searchQueryRef.current, count: true, results: false },
			throwOnError: true,
		});
		if (data.count === undefined) {
			throw new Error("the search returned no count for the selection");
		}
		return data.count;
	}, [mailboxId]);

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

	/**
	 * The unseen counts a run moved, per account. A cross-account selection has
	 * no single owning account — the surface leaves the option undefined exactly
	 * then — so the run's own targets are what name the accounts to refresh.
	 */
	const invalidateAfterRun = useCallback(
		(action: EscalatedAction, targets: readonly BulkActionTarget[]) => {
			invalidateThreadListQueries(
				queryClient,
				threadListCacheKeys(mailboxesTouchedBy(action, mailboxId)),
			);
			const touched = new Set<string>();
			if (accountId) touched.add(accountId);
			for (const target of targets) {
				if (target.accountId) touched.add(target.accountId);
			}
			for (const touchedAccountId of touched) {
				queryClient.invalidateQueries({
					queryKey: mailboxOperationsListMailboxesQueryKey({
						path: { accountId: touchedAccountId },
					}),
				});
			}
		},
		[queryClient, mailboxId, accountId],
	);

	const escalate = useCallback(() => {
		cancelRef.current = false;
		setPhase({ kind: "counting" });
		fetchMatchCount().then(
			(total) => {
				if (cancelRef.current) {
					setPhase({ kind: "idle" });
					return;
				}
				setPhase({ kind: "escalated", total });
			},
			(error: unknown) => {
				pushError(
					buildMutationErrorBanner(
						"Couldn't count matching messages",
						"The count didn't finish.",
						error,
					),
				);
				setPhase({ kind: "idle" });
			},
		);
	}, [fetchMatchCount, pushError]);

	const stop = useCallback(() => {
		cancelRef.current = true;
	}, []);

	const clear = useCallback(() => {
		if (runningRef.current) return;
		cancelRef.current = true;
		setPhase({ kind: "idle" });
	}, []);

	const runAction = useCallback(
		async (
			action: EscalatedAction,
			targets?: readonly BulkActionTarget[],
		): Promise<BulkRunOutcome> => {
			cancelRef.current = false;
			runningRef.current = true;
			setRunningAction(action);
			// `honestProgress` widens `total` if `done` overtakes it (#109) — the
			// predicate can match more by the time the run pages it than the count
			// saw, and the bar must never show more done than out of.
			const onProgress = (next: BulkActionProgress) =>
				setProgress(honestProgress(next));
			const applyBatch = applyBatchFor(action);
			// The predicate as it read when the run was confirmed. The run outlives
			// the screen that started it, so reading the live query on every page
			// would let a search typed afterwards redirect what is being deleted.
			const runPages = fetchPagesOf(searchQueryRef.current);

			// The one invariant nothing may lose: while `runningRef` is up, both
			// `clear` and the reset effect stand down, so a run that never marked
			// itself finished would leave an escalated selection nobody can leave.
			let outcome: BulkRunOutcome;
			try {
				outcome =
					targets !== undefined
						? await runChunkedAction(
								targets,
								applyBatch,
								onProgress,
								() => cancelRef.current,
							)
						: await runPredicateAction(
								runPages,
								phase.kind === "escalated" ? phase.total : 0,
								applyBatch,
								onProgress,
								() => cancelRef.current,
							);
			} finally {
				runningRef.current = false;
			}

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
				invalidateAfterRun(action, targets ?? []);
			}
			return outcome;
		},
		[applyBatchFor, fetchPagesOf, phase, pushError, invalidateAfterRun],
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
