import {
	mailboxOperationsListMailboxesQueryKey,
	syncOperationsGetSyncStatusOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { syncOperationsTriggerSync } from "@remit/api-http-client/sdk.gen.ts";
import type { RemitImapSyncPhase } from "@remit/api-http-client/types.gen.ts";
import type { RefreshControlState } from "@remit/ui";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { isSyncingPhase } from "@/hooks/useInitialSyncProgress";
import { shouldEscalate } from "@/lib/error-classifier";
import { reportFatalError } from "@/lib/fatal-error";
import { startHotSyncWindow } from "@/lib/hot-sync-window";
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

export interface AccountOutcome {
	accountId: string;
	message?: string;
}

/** The fields of `getSyncStatus` this wait reads, named so it can be driven
 * from a scripted sequence of readings. */
export interface SyncStatusReading {
	syncPhase?: RemitImapSyncPhase;
	lastSyncAt?: number;
	mailboxes?: readonly { fullPath?: string; lastSyncedAt?: number }[];
}

/**
 * The account's INBOX stamp, or 0 when the account has no INBOX or has never
 * synced one. `getSyncStatus` reports `lastSyncedAt` per mailbox, which is what
 * lets the wait answer "the inbox is current" ahead of "the round is done".
 */
export const inboxSyncedAt = (reading: SyncStatusReading): number =>
	reading.mailboxes?.find(
		(mailbox) => mailbox.fullPath?.toUpperCase() === "INBOX",
	)?.lastSyncedAt ?? 0;

export interface WaitForSettledOptions {
	accountId: string;
	readStatus: () => Promise<SyncStatusReading>;
	/** `lastSyncAt` as it read immediately before this refresh triggered. */
	baselineLastSyncAt: number;
	/** The INBOX `lastSyncedAt` from that same pre-trigger reading. */
	baselineInboxSyncedAt?: number;
	/** Called at most once, the moment INBOX's own stamp passes the baseline
	 * while the round is still running — never after the round has settled,
	 * which the caller already treats as the confirmed state. */
	onInboxSynced?: () => void;
	deadline: number;
	pollMs?: number;
}

/**
 * Poll one account's sync status until a round that started at or after this
 * refresh triggered has settled, or `deadline` passes.
 *
 * `account.lastSyncAt` is the worker's own once-per-round stamp, and it is the
 * only thing here that tells one round from another. A phase seen mid-flight
 * does not: the tab's background poll, another tab, and every `GET /config`
 * trigger rounds nobody clicked for, so a click landing while one of those is
 * in flight used to confirm on it — a checkmark and an invalidated list with
 * the clicked round still unrun, and the new mail it would have fetched unseen
 * until the next poll (#953). Requiring the stamp to pass the reading taken
 * before the trigger admits only a round that started after it.
 *
 * `POST /sync` enqueues and returns, so the first reading after triggering
 * still shows the previous round — including a previous round's `error` phase,
 * which is why that phase only speaks once the stamp has moved.
 *
 * A round is the whole account — every folder, in queue order — but the mail
 * a person pressed refresh for is in their inbox. `onInboxSynced` fires the
 * moment that one mailbox's own stamp passes the baseline, so the list on
 * screen reloads then rather than after Junk and Trash have also gone by. The
 * round-level stamp still decides the button's confirmed state.
 *
 * Read-only (`getSyncStatus`, no IMAP call, no queue write), so waiting costs
 * a handful of cheap GETs — never a refetch of the account's own message
 * list.
 */
export const waitForSettled = async ({
	accountId,
	readStatus,
	baselineLastSyncAt,
	baselineInboxSyncedAt = 0,
	onInboxSynced,
	deadline,
	pollMs = REFRESH_POLL_MS,
}: WaitForSettledOptions): Promise<AccountOutcome | undefined> => {
	let inboxAnnounced = false;
	for (;;) {
		const outcome = await readStatus()
			.then((data) => ({ ok: true as const, data }))
			.catch((error: unknown) => ({ ok: false as const, error }));
		if (!outcome.ok) {
			return { accountId, message: messageFor(outcome.error) };
		}
		const { syncPhase, lastSyncAt } = outcome.data;
		const startedAfterTrigger = (lastSyncAt ?? 0) > baselineLastSyncAt;
		if (startedAfterTrigger && !isSyncingPhase(syncPhase)) {
			if (syncPhase === "error") {
				return { accountId, message: "Sync failed for this account" };
			}
			return undefined;
		}
		if (
			!inboxAnnounced &&
			inboxSyncedAt(outcome.data) > baselineInboxSyncedAt
		) {
			inboxAnnounced = true;
			onInboxSynced?.();
		}
		if (Date.now() >= deadline) {
			return { accountId, message: "Refresh is taking longer than usual" };
		}
		await sleep(pollMs);
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
	onInboxSynced: (accountId: string) => void,
): Promise<AccountResult> => {
	const baseline = await fetchStatus(queryClient, accountId)
		.then((data) => ({
			ok: true as const,
			lastSyncAt: data.lastSyncAt ?? 0,
			inboxSyncedAt: inboxSyncedAt(data),
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

	const settled = await waitForSettled({
		accountId,
		readStatus: () => fetchStatus(queryClient, accountId),
		baselineLastSyncAt: baseline.lastSyncAt,
		baselineInboxSyncedAt: baseline.inboxSyncedAt,
		onInboxSynced: () => onInboxSynced(accountId),
		deadline,
	});
	if (settled)
		return { accountId, enqueued: true, ok: false, message: settled.message };
	return { accountId, enqueued: true, ok: true };
};

export interface UseRefreshControlOptions {
	/** The caller's chance to invalidate whatever view-specific query (a
	 * mailbox's thread list, the brief's unified list) the sync may have
	 * changed, alongside the invalidation of the account's own mailbox-list
	 * query.
	 *
	 * Called more than once per press: once per account the moment its INBOX
	 * is current, and again once its whole round has settled. It must
	 * therefore be idempotent — an invalidation is. */
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

		startHotSyncWindow();

		// The account's own lists, reloaded. Called once as soon as that
		// account's INBOX is current and again when its round confirms: the
		// first is what puts the new mail on screen without waiting for Junk
		// and Trash, the second is the settled state.
		const showAccount = (accountId: string): void => {
			if (runIdRef.current !== runId) return;
			queryClient.invalidateQueries({
				queryKey: mailboxOperationsListMailboxesQueryKey({
					path: { accountId },
				}),
			});
			optionsRef.current.onSettled?.();
		};

		void (async () => {
			const deadline = Date.now() + REFRESH_TIMEOUT_MS;
			const results = await Promise.all(
				ids.map((accountId) =>
					refreshOneAccount(
						queryClient,
						telemetry,
						accountId,
						deadline,
						showAccount,
					),
				),
			);
			if (runIdRef.current !== runId) return;

			const enqueued = results
				.filter((result) => result.enqueued)
				.map((result) => result.accountId);
			for (const accountId of enqueued) showAccount(accountId);
			if (enqueued.length > 0) {
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
