import { mailboxOperationsListMailboxesQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { syncOperationsTriggerSync } from "@remit/api-http-client/sdk.gen.ts";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

/**
 * Mailboxes are considered stale 15 minutes after the last successful sync.
 * Exposed for unit tests and possible future tuning.
 */
export const STALENESS_THRESHOLD_MS = 15 * 60 * 1000;

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
 * Test-only helpers. Not exported from the public hook surface; consumers
 * should never reach into the module-level Set directly.
 */
export const __resetStaleAccountSyncGuard = (): void => {
	triggeredAccountIds.clear();
};
export const __peekStaleAccountSyncGuard = (): ReadonlySet<string> =>
	triggeredAccountIds;

/**
 * Handle a failed background mailbox-sync trigger. This is a best-effort,
 * direct SDK probe (the global React Query `retry`/escalation does not apply),
 * so a single failure — even a 5xx — is one unlucky trigger on mount, not proof
 * the backend is down. It must NEVER escalate to the full-screen fatal overlay
 * (the over-fire #745 introduced). We drop the per-account guard so a later
 * remount can retry, then log and move on. The explicit, surfaced path stays
 * the "Refresh mailboxes" button in Settings.
 */
export const handleBackgroundSyncFailure = (
	accountId: string,
	error: unknown,
): void => {
	triggeredAccountIds.delete(accountId);
	console.warn("[remit] background mailbox sync failed", {
		accountId,
		error,
	});
};

/**
 * Auto-trigger a background mailbox-list sync for every stale account
 * the first time MailLayout mounts in a session. Fire-and-forget: does
 * not block render, and silently logs failures (this is a best-effort
 * background refresh — the user-visible UI for triggering is the
 * "Refresh mailboxes" button in Settings).
 *
 * Uses a stable dependency derived from `accountIds.join(",")` so adding
 * or removing an account re-runs the effect, but unrelated re-renders
 * don't.
 */
export const useStaleAccountSync = (
	accounts: RemitImapAccountResponse[],
): void => {
	const queryClient = useQueryClient();
	// Hold the latest accounts in a ref so the effect can read them without
	// re-running on every render; we re-run only when the joined accountId
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
			// `throwOnError: true` so a server failure rejects instead of silently
			// resolving with `{ error }` (the default), which would let a 500 look
			// like a successful sync and invalidate queries anyway.
			syncOperationsTriggerSync({ path: { accountId }, throwOnError: true })
				.then(() => {
					queryClient.invalidateQueries({
						queryKey: mailboxOperationsListMailboxesQueryKey({
							path: { accountId },
						}),
					});
				})
				.catch((err: unknown) => {
					handleBackgroundSyncFailure(accountId, err);
				});
		}
	}, [stableKey, queryClient]);
};
