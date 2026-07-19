import { mailboxOperationsListMailboxesQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { syncOperationsTriggerSync } from "@remit/api-http-client/sdk.gen.ts";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import pMap from "p-map";
import { useEffect, useRef } from "react";
import { shouldEscalate } from "@/lib/error-classifier";
import { reportFatalError } from "@/lib/fatal-error";
import { getRuntimeConfig } from "@/runtime-config";

/**
 * Mailboxes are considered stale 15 minutes after the last successful sync.
 * Exposed for unit tests and possible future tuning.
 */
export const STALENESS_THRESHOLD_MS = 15 * 60 * 1000;

const DEFAULT_POLL_INTERVAL_SECONDS = 5 * 60;

const parsePositiveIntSeconds = (
	raw: string | undefined,
	fallback: number,
): number => {
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Floor for the poll interval, matching `MAILBOX_FRESHNESS_MS` in the
 * imap-worker's sync-mailboxes fan-out.
 *
 * This poll uses POST /sync, the same endpoint as a person pressing refresh,
 * and that endpoint's triggers skip the server's per-mailbox freshness gate.
 * A timer is not a person: polling faster than the gate's own window would
 * make every tick a full folder-by-folder re-enumeration for every open
 * account — the fan-out storm the gate exists to prevent, reintroduced by a
 * config value. `mailboxPollIntervalSeconds` can lengthen the interval, never
 * shorten it past this: below the window there is nothing to gain, since no
 * mailbox can have become stale in the meantime.
 */
export const MIN_POLL_INTERVAL_MS = 60 * 1000;

/**
 * Resolve the configured poll interval, never returning less than
 * {@link MIN_POLL_INTERVAL_MS}.
 */
export const resolvePollIntervalMs = (
	configuredSeconds: string | undefined,
): number =>
	Math.max(
		parsePositiveIntSeconds(configuredSeconds, DEFAULT_POLL_INTERVAL_SECONDS) *
			1000,
		MIN_POLL_INTERVAL_MS,
	);

/**
 * Client-side online-poll interval (#1251): while an account's mail is open,
 * the tab re-triggers the same sync the pull-to-refresh path uses on this
 * cadence — the replacement for the server's removed "online tier".
 */
export const POLL_INTERVAL_MS = resolvePollIntervalMs(
	getRuntimeConfig().mailboxPollIntervalSeconds,
);

/**
 * Bounded concurrency for the per-poll fan-out across open accounts —
 * mirrors `SCHEDULER_ENQUEUE_CONCURRENCY` in
 * remit-imap-worker/src/scheduler/config.ts (never an unbounded
 * `Promise.all`, see doc/rules/coding-standards.md). A browser tab realistically
 * has a handful of accounts open at once, so this is a ceiling, not a tuned
 * throughput target.
 */
export const POLL_CONCURRENCY = 5;

/**
 * Module-level guard: which accounts have already had a background sync
 * fired in this browser tab's session. Survives layout re-mounts (route
 * changes) so re-mounting MailLayout does not spam SQS.
 */
const triggeredAccountIds = new Set<string>();

interface AccountLike {
	accountId: string;
	lastSyncAt?: number;
}

/**
 * Pure selector: given a list of accounts and the current time, return
 * the accountIds whose mailbox-list is stale and should be refreshed.
 * `null`/`undefined` `lastSyncAt` is treated as stale unconditionally.
 */
export const selectStaleAccountIds = (
	accounts: AccountLike[],
	now: number,
	thresholdMs: number = STALENESS_THRESHOLD_MS,
): string[] =>
	accounts
		.filter((account) => {
			const last = account.lastSyncAt;
			if (last === undefined || last === null) return true;
			return now - last > thresholdMs;
		})
		.map((account) => account.accountId);

/**
 * Pure predicate: has at least one full poll interval elapsed since the last
 * poll? Shared by the recurring timer and the visibility-regain catch-up
 * check so both use the exact same due-ness rule.
 */
export const hasPollIntervalElapsed = (
	now: number,
	lastPollAt: number,
	intervalMs: number = POLL_INTERVAL_MS,
): boolean => now - lastPollAt >= intervalMs;

/**
 * Pure selector: drop any accountId already mid-flight so a poll tick never
 * stacks a second request onto one still in progress.
 */
export const selectPollableAccountIds = (
	accountIds: string[],
	inFlight: ReadonlySet<string>,
): string[] => accountIds.filter((id) => !inFlight.has(id));

/**
 * Test-only helpers. Not exported from the public hook surface; consumers
 * should never reach into the module-level Set directly.
 */
export const __resetStaleAccountSyncGuard = (): void => {
	triggeredAccountIds.clear();
};
export const __peekStaleAccountSyncGuard = (): ReadonlySet<string> =>
	triggeredAccountIds;

/**
 * Handle a failed background mailbox-sync trigger. This is a best-effort, direct
 * SDK probe (not a React Query call), so we apply the same fail-fast decision by
 * hand with the `softError` meta the call site owns: its non-5xx failures (the
 * account's own 4xx, a statusless connectivity blip) stay soft — we drop the
 * per-account guard so a later remount can retry, then log and move on. But a
 * 5xx is OUR API broken, and per the contract (#1059) that always escalates to
 * the full-screen overlay — even from a background trigger.
 */
export const handleBackgroundSyncFailure = (
	accountId: string,
	error: unknown,
): void => {
	triggeredAccountIds.delete(accountId);
	if (shouldEscalate(error, { softError: true })) {
		reportFatalError(error);
		return;
	}
	console.warn("[remit] background mailbox sync failed", {
		accountId,
		error,
	});
};

/**
 * Trigger the same sync the pull-to-refresh path uses and invalidate the
 * mailbox-list query on success. `throwOnError: true` so a server failure
 * rejects instead of silently resolving with `{ error }` (the default),
 * which would let a 500 look like a successful sync and invalidate queries
 * anyway.
 */
const runBackgroundSync = (
	accountId: string,
	queryClient: QueryClient,
): Promise<void> =>
	syncOperationsTriggerSync({ path: { accountId }, throwOnError: true }).then(
		() => {
			queryClient.invalidateQueries({
				queryKey: mailboxOperationsListMailboxesQueryKey({
					path: { accountId },
				}),
			});
		},
	);

/**
 * Auto-trigger a background mailbox-list sync for every stale account the
 * first time MailLayout mounts in a session, then keep it fresh with a
 * recurring online poll for as long as the mail app stays open (#1251) —
 * the client-side replacement for the server's removed "online" sync tier.
 * Fire-and-forget: does not block render, and silently logs failures (this
 * is a best-effort background refresh — the user-visible UI for triggering
 * is the "Refresh mailboxes" button in Settings).
 */
export const useStaleAccountSync = (
	accounts: RemitImapAccountResponse[],
): void => {
	const queryClient = useQueryClient();
	// Hold the latest accounts in a ref so both effects can read them without
	// re-running on every render; they re-run only when the joined accountId
	// list actually changes (account added / removed).
	const accountsRef = useRef(accounts);
	accountsRef.current = accounts;
	const stableKey = accounts.map((a) => a.accountId).join(",");

	// biome-ignore lint/correctness/useExhaustiveDependencies: stableKey is a serialized account list used to trigger re-sync on account changes; adding it would cause issues without also referencing accountsRef
	useEffect(() => {
		const now = Date.now();
		const stale = selectStaleAccountIds(accountsRef.current, now);
		const fresh = stale.filter((id) => !triggeredAccountIds.has(id));
		if (fresh.length === 0) return;

		for (const accountId of fresh) {
			triggeredAccountIds.add(accountId);
			runBackgroundSync(accountId, queryClient).catch((err: unknown) => {
				handleBackgroundSyncFailure(accountId, err);
			});
		}
	}, [stableKey, queryClient]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: stableKey re-runs the poll loop when the account list changes; accountsRef supplies the live list each tick
	useEffect(() => {
		let lastPollAt = Date.now();
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		const inFlight = new Set<string>();

		const poll = () => {
			lastPollAt = Date.now();
			const ids = selectPollableAccountIds(
				accountsRef.current.map((a) => a.accountId),
				inFlight,
			);
			// Mark every selected id in flight before dispatch (not as pMap
			// starts each one) so a concurrency-queued id still counts as
			// "already polling" for the next tick's `selectPollableAccountIds`
			// check — no stacked requests even while waiting for a free slot.
			for (const accountId of ids) inFlight.add(accountId);
			void pMap(
				ids,
				(accountId) =>
					runBackgroundSync(accountId, queryClient)
						.catch((err: unknown) => {
							handleBackgroundSyncFailure(accountId, err);
						})
						.finally(() => {
							inFlight.delete(accountId);
						}),
				{ concurrency: POLL_CONCURRENCY },
			);
		};

		const tick = () => {
			if (document.visibilityState === "visible") {
				poll();
				timeoutId = setTimeout(tick, POLL_INTERVAL_MS);
				return;
			}
			// Hidden: don't reschedule. `handleVisibilityChange` resumes the loop
			// (with an immediate catch-up poll) once the tab is visible again.
		};

		const handleVisibilityChange = () => {
			if (document.visibilityState !== "visible") return;
			if (!hasPollIntervalElapsed(Date.now(), lastPollAt)) return;
			if (timeoutId !== undefined) clearTimeout(timeoutId);
			poll();
			timeoutId = setTimeout(tick, POLL_INTERVAL_MS);
		};

		timeoutId = setTimeout(tick, POLL_INTERVAL_MS);
		document.addEventListener("visibilitychange", handleVisibilityChange);

		return () => {
			if (timeoutId !== undefined) clearTimeout(timeoutId);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, [stableKey, queryClient]);
};
