import {
	mailboxOperationsListMailboxesQueryKey,
	threadOperationsListThreadsQueryKey,
	threadOperationsSearchThreadsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	messageBulkOperationsDeleteMessages,
	threadOperationsSearchThreads,
} from "@remit/api-http-client/sdk.gen.ts";
import type { ThreadOperationsSearchThreadsData } from "@remit/api-http-client/types.gen.ts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { buildMutationErrorBanner } from "@/components/ui/error-banners";
import {
	type BulkDeleteProgress,
	countMatches,
	type DeleteRunOutcome,
	type FetchIdsPage,
	runChunkedDelete,
	runPredicateDelete,
} from "@/lib/bulk-delete";

/** The predicate a search-scoped delete re-issues on every page — the same
 *  filters the visible list is searching with, minus pagination/count knobs. */
export type EscalationSearchQuery = Pick<
	NonNullable<ThreadOperationsSearchThreadsData["query"]>,
	"order" | "query" | "subject" | "from" | "unread" | "starred" | "attachments"
>;

/** Page size for both the counting and the execution loop. Set to the write
 *  side's own 100-id cap so an execution page IS a delete chunk — no
 *  in-memory accumulation step between reading ids and sending them. Counting
 *  doesn't have that constraint but reuses the same page size rather than
 *  adding a second one to reason about. */
const PAGE_SIZE = 100;

export type EscalationPhase =
	| { kind: "idle" }
	| { kind: "counting"; countSoFar: number }
	| { kind: "escalated"; total: number };

interface UseEscalatedDeleteOptions {
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

export interface UseEscalatedDeleteResult {
	phase: EscalationPhase;
	/** Begin paging the predicate's full match set to find its total. */
	escalate: () => void;
	/** Stop whatever's running — counting or a delete — at the next page
	 *  boundary. A no-op when nothing is running. */
	stop: () => void;
	/** Drop an escalated selection back to bounded without confirming anything. */
	clear: () => void;
	/** True while a chunked delete (bounded->100 ids, or the escalated
	 *  predicate) is running. */
	isDeleting: boolean;
	deleteProgress: BulkDeleteProgress | undefined;
	/**
	 * Runs a chunked delete. Pass `ids` for a materialized (bounded) selection;
	 * omit it to delete the escalated predicate (`phase` must be "escalated").
	 * Resolves once the run ends for any reason — cancelled, errored, or
	 * complete — with a `done`/`failedIds` outcome the caller feeds to
	 * `resolveSelectionAfterDelete` to decide what selection looks like next.
	 * Infrastructure failures are reported through the app's existing
	 * escalation seam (`pushError`, which itself escalates a 5xx/exception to
	 * the fatal overlay) — not swallowed here.
	 */
	runDelete: (ids?: string[]) => Promise<DeleteRunOutcome>;
}

export const useEscalatedDelete = ({
	mailboxId,
	accountId,
	enabled,
	predicateKey,
	searchQuery,
}: UseEscalatedDeleteOptions): UseEscalatedDeleteResult => {
	const [phase, setPhase] = useState<EscalationPhase>({ kind: "idle" });
	const [isDeleting, setIsDeleting] = useState(false);
	const [deleteProgress, setDeleteProgress] = useState<
		BulkDeleteProgress | undefined
	>(undefined);
	const cancelRef = useRef(false);
	const queryClient = useQueryClient();
	const { pushError } = useErrorBanners();

	// A different search (or leaving search/desktop) makes any in-flight
	// escalation meaningless — it would otherwise keep counting or offering to
	// delete a predicate the visible list no longer reflects.
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

	const deleteBatch = useCallback(async (ids: string[]) => {
		const { data } = await messageBulkOperationsDeleteMessages({
			body: { messageIds: ids },
			throwOnError: true,
		});
		return data;
	}, []);

	const invalidateAfterDelete = useCallback(() => {
		queryClient.invalidateQueries({
			queryKey: threadOperationsListThreadsQueryKey({ path: { mailboxId } }),
		});
		queryClient.invalidateQueries({
			queryKey: threadOperationsSearchThreadsQueryKey({ path: { mailboxId } }),
		});
		if (accountId) {
			queryClient.invalidateQueries({
				queryKey: mailboxOperationsListMailboxesQueryKey({
					path: { accountId },
				}),
			});
		}
	}, [queryClient, mailboxId, accountId]);

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

	const runDelete = useCallback(
		async (ids?: string[]): Promise<DeleteRunOutcome> => {
			cancelRef.current = false;
			setIsDeleting(true);
			const onProgress = (progress: BulkDeleteProgress) =>
				setDeleteProgress(progress);

			const outcome =
				ids !== undefined
					? await runChunkedDelete(
							ids,
							deleteBatch,
							onProgress,
							() => cancelRef.current,
						)
					: await runPredicateDelete(
							fetchIdsPage,
							phase.kind === "escalated" ? phase.total : 0,
							deleteBatch,
							onProgress,
							() => cancelRef.current,
						);

			setIsDeleting(false);
			setDeleteProgress(undefined);
			setPhase({ kind: "idle" });

			if (outcome.error) {
				pushError(
					buildMutationErrorBanner(
						outcome.done > 0
							? `Stopped after ${outcome.done} — some messages weren't deleted`
							: "Couldn't delete these messages",
						"The delete didn't finish.",
						outcome.error,
					),
				);
			}
			if (outcome.done > 0) {
				invalidateAfterDelete();
			}
			return outcome;
		},
		[deleteBatch, fetchIdsPage, phase, pushError, invalidateAfterDelete],
	);

	return {
		phase,
		escalate,
		stop,
		clear,
		isDeleting,
		deleteProgress,
		runDelete,
	};
};
