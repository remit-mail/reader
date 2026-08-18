import {
	mailboxOperationsListMailboxesQueryKey,
	syncOperationsGetSyncStatusOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { syncOperationsTriggerSync } from "@remit/api-http-client/sdk.gen.ts";
import type { RemitImapMailboxSyncProgress } from "@remit/api-http-client/types.gen.ts";
import type { RefreshControlState } from "@remit/ui";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { isSyncingPhase } from "@/hooks/useInitialSyncProgress";
import { shouldEscalate } from "@/lib/error-classifier";
import { reportFatalError } from "@/lib/fatal-error";
import { useMailFreshness } from "@/lib/mail-freshness";
import { useTelemetry } from "@/lib/telemetry-context";

export type { RefreshControlState };

/** How often the wait polls an account's own sync status once a round is
 * enqueued — fast enough to feel responsive, far below the once-a-minute
 * background cadence, and bounded by {@link REFRESH_TIMEOUT_MS} either way. */
export const REFRESH_POLL_MS = 2000;

/** A refresh that gets no answer must terminate in a stated failure rather
 * than spin forever — this is that bound. */
export const REFRESH_TIMEOUT_MS = 45_000;

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

const messageFor = (error: unknown): string =>
	error instanceof Error && error.message
		? error.message
		: "Something went wrong";

// The user pulled to refresh and is watching the spinner, so this is theirs to
// be answered: a 401 here escalates over the soft meta rather than resolving
// into a spinner that stops for no stated reason.
const escalateIfFatal = (error: unknown): void => {
	if (shouldEscalate(error, { softError: true }, "user")) {
		reportFatalError(error);
	}
};

const maxLastSynced = (
	mailboxes: readonly RemitImapMailboxSyncProgress[],
): number =>
	mailboxes.reduce(
		(max, mailbox) => Math.max(max, mailbox.lastSyncedAt ?? 0),
		0,
	);

/**
 * `getSyncStatus` for one account, always as a real network read: `staleTime:
 * 0` means even a reading `MailFreshnessProvider` fetched a moment ago is
 * treated as stale. Sharing the query key means every fetch here also lands
 * in the same cache `MailFreshnessProvider` reads, so acknowledging a refresh
 * (see `useMailFreshness().acknowledge`) re-baselines from data this wait
 * itself just fetched — never a round-old cached reading.
 *
 * Routed through `queryClient.fetchQuery` rather than the raw SDK call, so a
 * failure here already reaches the global `QueryCache` error sink
 * (`main.tsx` wires `handleQueryCacheError`) on the same terms as every other
 * query — a manual `escalateIfFatal` on top would double-report the same
 * error. `syncOperationsTriggerSync` below is the one call in this file that
 * genuinely needs it: it's a raw SDK call outside React Query, so nothing
 * else escalates it.
 */
const fetchStatus = (queryClient: QueryClient, accountId: string) =>
	queryClient.fetchQuery({
		...syncOperationsGetSyncStatusOptions({ path: { accountId } }),
		staleTime: 0,
	});

interface AccountOutcome {
	accountId: string;
	message?: string;
}

/**
 * Poll one account's sync status until a round that started after
 * `baselineMaxLastSynced` was captured has settled, or `deadline` passes.
 *
 * `POST /sync` only enqueues the round (the worker runs it later), so the
 * very first status read after triggering can still show the *previous*
 * round's phase — reading that as "settled" would report success, or a
 * stale failed phase, before the new round ever ran (#582 review). This
 * waits for positive evidence the triggered round actually happened: either
 * the phase was observed mid-flight, or some mailbox's `lastSyncedAt`
 * advanced past the baseline taken before the trigger.
 *
 * Read-only (`getSyncStatus`, no IMAP call, no queue write), so waiting costs
 * a handful of cheap GETs — never a refetch of the account's own message
 * list.
 */
const waitForSettled = async (
	queryClient: QueryClient,
	accountId: string,
	baselineMaxLastSynced: number,
	deadline: number,
): Promise<AccountOutcome | undefined> => {
	let observedInProgress = false;
	for (;;) {
		const outcome = await fetchStatus(queryClient, accountId)
			.then((data) => ({ ok: true as const, data }))
			.catch((error: unknown) => ({ ok: false as const, error }));
		if (!outcome.ok) {
			return { accountId, message: messageFor(outcome.error) };
		}
		const { syncPhase, mailboxes } = outcome.data;
		if (isSyncingPhase(syncPhase)) {
			observedInProgress = true;
		} else {
			const confirmed =
				observedInProgress ||
				maxLastSynced(mailboxes ?? []) > baselineMaxLastSynced;
			if (confirmed) {
				if (syncPhase === "error") {
					return { accountId, message: "Sync failed for this account" };
				}
				return undefined;
			}
		}
		if (Date.now() >= deadline) {
			return { accountId, message: "Refresh is taking longer than usual" };
		}
		await sleep(REFRESH_POLL_MS);
	}
};

interface AccountResult {
	accountId: string;
	/** The trigger itself was accepted — the mailbox-list invalidation and
	 * `onSettled`/`acknowledge` calls run for every enqueued account,
	 * independent of whether its own round then succeeded. */
	enqueued: boolean;
	ok: boolean;
	message?: string;
}

const refreshOneAccount = async (
	queryClient: QueryClient,
	telemetry: { recordEvent: (name: string) => void },
	accountId: string,
	deadline: number,
): Promise<AccountResult> => {
	const baseline = await fetchStatus(queryClient, accountId)
		.then((data) => ({
			ok: true as const,
			maxLastSynced: maxLastSynced(data.mailboxes ?? []),
		}))
		.catch((error: unknown) => ({ ok: false as const, error }));
	if (!baseline.ok) {
		return {
			accountId,
			enqueued: false,
			ok: false,
			message: messageFor(baseline.error),
		};
	}

	const triggered = await syncOperationsTriggerSync({
		path: { accountId },
		throwOnError: true,
	})
		.then(() => ({ ok: true as const }))
		.catch((error: unknown) => ({ ok: false as const, error }));
	if (!triggered.ok) {
		escalateIfFatal(triggered.error);
		return {
			accountId,
			enqueued: false,
			ok: false,
			message: messageFor(triggered.error),
		};
	}
	telemetry.recordEvent("sync.triggered");

	const settled = await waitForSettled(
		queryClient,
		accountId,
		baseline.maxLastSynced,
		deadline,
	);
	if (settled)
		return { accountId, enqueued: true, ok: false, message: settled.message };
	return { accountId, enqueued: true, ok: true };
};

export interface UseRefreshControlOptions {
	/** Called once every enqueued account's sync round has settled, alongside
	 * the unconditional invalidation of each enqueued account's own
	 * mailbox-list query — the caller's chance to invalidate whatever
	 * view-specific query (a mailbox's thread list, the brief's unified list)
	 * the sync may have changed. */
	onSettled?: () => void;
}

export interface UseRefreshControlResult {
	state: RefreshControlState;
	errorMessage?: string;
	refresh: () => void;
}

/**
 * Drives the shared `RefreshButton` for one or more accounts: triggers a sync
 * for each, waits for the server's own sync-status to settle — not just the
 * enqueue ack — then invalidates the queries the caller names. A manual
 * refresh is an explicit user action, so unlike the background poll it always
 * shows the result; what it must never do is leave the button spinning with
 * no answer.
 */
export const useRefreshControl = (
	accountIds: readonly string[],
	options: UseRefreshControlOptions = {},
): UseRefreshControlResult => {
	const queryClient = useQueryClient();
	const telemetry = useTelemetry();
	const { acknowledge } = useMailFreshness();
	const [state, setState] = useState<RefreshControlState>("idle");
	const [errorMessage, setErrorMessage] = useState<string>();
	const runIdRef = useRef(0);
	const accountIdsRef = useRef(accountIds);
	accountIdsRef.current = accountIds;
	const optionsRef = useRef(options);
	optionsRef.current = options;

	// A success confirmation is a beat, not a permanent state — it hands the
	// button back to idle on its own so a stale checkmark never lingers.
	useEffect(() => {
		if (state !== "success") return;
		const timer = setTimeout(() => setState("idle"), 2000);
		return () => clearTimeout(timer);
	}, [state]);

	const refresh = useCallback(() => {
		const ids = accountIdsRef.current;
		if (ids.length === 0) {
			// Reachable before the owning account resolves (a fresh mailbox
			// route) or when every account is muted (the brief) — a click here
			// must say why it did nothing, never sit as a dead button.
			setState("error");
			setErrorMessage("Nothing to refresh yet");
			return;
		}
		const runId = ++runIdRef.current;
		setState("refreshing");
		setErrorMessage(undefined);

		void (async () => {
			const deadline = Date.now() + REFRESH_TIMEOUT_MS;
			const results = await Promise.all(
				ids.map((accountId) =>
					refreshOneAccount(queryClient, telemetry, accountId, deadline),
				),
			);
			if (runIdRef.current !== runId) return;

			const enqueued = results
				.filter((result) => result.enqueued)
				.map((result) => result.accountId);
			for (const accountId of enqueued) {
				queryClient.invalidateQueries({
					queryKey: mailboxOperationsListMailboxesQueryKey({
						path: { accountId },
					}),
				});
			}
			if (enqueued.length > 0) {
				optionsRef.current.onSettled?.();
				acknowledge(enqueued);
			}

			const failures = results.filter((result) => !result.ok);
			if (failures.length === 0) {
				setState("success");
			} else {
				setState("error");
				setErrorMessage(failures[0]?.message);
			}
		})();
	}, [acknowledge, queryClient, telemetry]);

	return { state, errorMessage, refresh };
};
