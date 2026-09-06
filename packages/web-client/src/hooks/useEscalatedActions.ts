import {
	messageBulkOperationsDeleteMessages,
	messageBulkOperationsMoveMessages,
	messageBulkOperationsUpdateFlags,
	threadOperationsSearchThreads,
} from "@remit/api-http-client/sdk.gen.ts";
import type { ThreadOperationsSearchThreadsData } from "@remit/api-http-client/types.gen.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type BulkRunRequest,
	type BulkRunSource,
	useBulkRun,
} from "@/components/mail/BulkRunProvider";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { buildMutationErrorBanner } from "@/components/ui/error-banners";
import type {
	ApplyBatch,
	BulkActionProgress,
	BulkActionTarget,
	BulkRunOutcome,
	EscalatedAction,
	FetchIdsPage,
} from "@/lib/bulk-actions";

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
	/**
	 * States how a run ended, for a user who is no longer looking at any screen
	 * that could show it. Handed to the run's owner rather than called here, so
	 * an ending that lands after this hook unmounted is still said (#112).
	 */
	reportEnding?: BulkRunRequest["reportEnding"];
}

export interface UseEscalatedActionsResult {
	phase: EscalationPhase;
	/** Ask the server how many messages the predicate matches, and switch the
	 *  selection to that predicate once it answers. */
	escalate: () => void;
	/**
	 * Stop whatever's running — the count or an action. The request in flight is
	 * aborted and nothing further leaves (#113); a delete the server has already
	 * accepted still applies, so the batch on the wire is what a stop is worth.
	 * A no-op when nothing is running. The only thing that ends a run in
	 * flight: leaving the selection, the wizard, the search or the mailbox does
	 * not.
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
	 *  over this mailbox is in flight, whichever screen started it. */
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
	 *
	 * The run itself belongs to `BulkRunProvider`, which outlives every screen
	 * that can show it: the caches, the refusal replay, the failure banner and
	 * the ending are its, so none of them are lost when the surface that started
	 * the run goes (#112).
	 */
	runAction: (
		action: EscalatedAction,
		targets?: readonly BulkActionTarget[],
	) => Promise<BulkRunOutcome>;
}

export const useEscalatedActions = ({
	mailboxId,
	accountId,
	enabled,
	predicateKey,
	searchQuery,
	reportEnding,
}: UseEscalatedActionsOptions): UseEscalatedActionsResult => {
	const [phase, setPhase] = useState<EscalationPhase>({ kind: "idle" });
	// The count's own signal, which is not the run's: leaving the search ends a
	// count, and never a run (#112).
	const countAbortRef = useRef<AbortController | undefined>(undefined);
	const { run, start, stop: stopRun } = useBulkRun();
	const { pushError } = useErrorBanners();

	// The live run, when it is this mailbox's. A run is mail leaving one mailbox,
	// so it reports on that mailbox's list — not on whichever list is on screen.
	const activeRun = run?.mailboxId === mailboxId ? run : undefined;
	const isRunning = activeRun !== undefined;
	// Read by callbacks that must not close over a stale render's answer.
	const isRunningRef = useRef(false);
	isRunningRef.current = isRunning;

	// A different search (or leaving search/desktop) makes any in-flight
	// escalation meaningless — it would otherwise keep counting or offering to
	// act on a predicate the visible list no longer reflects. The selection goes;
	// a run already going does not. It pages the predicate it was started
	// against and reports what it reached, wherever the list moved on to.
	// biome-ignore lint/correctness/useExhaustiveDependencies: enabled/predicateKey are trigger-only — the reset itself reads neither.
	useEffect(() => {
		countAbortRef.current?.abort();
		setPhase({ kind: "idle" });
	}, [enabled, predicateKey]);

	const searchQueryRef = useRef(searchQuery);
	searchQueryRef.current = searchQuery;

	const fetchPagesOf = useCallback(
		(query: EscalationSearchQuery): FetchIdsPage =>
			async (continuationToken, signal) => {
				const { data } = await threadOperationsSearchThreads({
					path: { mailboxId },
					query: { ...query, continuationToken, limit: PAGE_SIZE },
					signal,
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
	const fetchMatchCount = useCallback(
		async (signal: AbortSignal): Promise<number> => {
			const { data } = await threadOperationsSearchThreads({
				path: { mailboxId },
				query: { ...searchQueryRef.current, count: true, results: false },
				signal,
				throwOnError: true,
			});
			if (data.count === undefined) {
				throw new Error("the search returned no count for the selection");
			}
			return data.count;
		},
		[mailboxId],
	);

	const applyBatchFor = useCallback(
		(action: EscalatedAction): ApplyBatch =>
			async (ids: string[], signal: AbortSignal) => {
				if (action.kind === "move") {
					const { data } = await messageBulkOperationsMoveMessages({
						body: {
							messageIds: ids,
							destinationMailboxId: action.destinationMailboxId,
						},
						signal,
						throwOnError: true,
					});
					return data;
				}
				if (action.kind === "markRead") {
					const { data } = await messageBulkOperationsUpdateFlags({
						body: { messageIds: ids, isRead: true },
						signal,
						throwOnError: true,
					});
					return data;
				}
				const { data } = await messageBulkOperationsDeleteMessages({
					body: { messageIds: ids },
					signal,
					throwOnError: true,
				});
				return data;
			},
		[],
	);

	const escalate = useCallback(() => {
		const controller = new AbortController();
		countAbortRef.current = controller;
		setPhase({ kind: "counting" });
		fetchMatchCount(controller.signal).then(
			(total) => {
				if (controller.signal.aborted) {
					setPhase({ kind: "idle" });
					return;
				}
				setPhase({ kind: "escalated", total });
			},
			(error: unknown) => {
				// A stopped count rejects with its own abort. That is the press the
				// user made, not a failure to report back to them.
				if (controller.signal.aborted) {
					setPhase({ kind: "idle" });
					return;
				}
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
		countAbortRef.current?.abort();
		stopRun();
	}, [stopRun]);

	const clear = useCallback(() => {
		if (isRunningRef.current) return;
		countAbortRef.current?.abort();
		setPhase({ kind: "idle" });
	}, []);

	const runAction = useCallback(
		async (
			action: EscalatedAction,
			targets?: readonly BulkActionTarget[],
		): Promise<BulkRunOutcome> => {
			// Read before the run clears the phase below, so a refusal can say how
			// many messages the appointment's replay is about.
			const matched =
				targets?.length ?? (phase.kind === "escalated" ? phase.total : 0);
			// The predicate as it read when the run was confirmed. The run outlives
			// the screen that started it, so reading the live query on every page
			// would let a search typed afterwards redirect what is being deleted.
			const source: BulkRunSource =
				targets !== undefined
					? { kind: "targets", targets }
					: {
							kind: "predicate",
							fetchPage: fetchPagesOf(searchQueryRef.current),
						};

			const outcome = await start({
				action,
				mailboxId,
				accountId,
				matched,
				source,
				applyBatch: applyBatchFor(action),
				reportEnding,
			});

			// The escalated selection was what the run was confirmed from, and the
			// run has now happened to it.
			setPhase({ kind: "idle" });
			return outcome;
		},
		[
			applyBatchFor,
			fetchPagesOf,
			phase,
			mailboxId,
			accountId,
			reportEnding,
			start,
		],
	);

	return {
		phase,
		escalate,
		stop,
		clear,
		isRunning,
		runningAction: activeRun?.action,
		progress: activeRun?.progress,
		runAction,
	};
};
