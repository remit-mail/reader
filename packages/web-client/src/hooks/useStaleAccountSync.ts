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

	useEffect(() => {
		const now = Date.now();
		const stale = selectStaleAccountIds(accountsRef.current, now);
		const fresh = stale.filter((id) => !triggeredAccountIds.has(id));
		if (fresh.length === 0) return;

		for (const accountId of fresh) {
			triggeredAccountIds.add(accountId);
			syncOperationsTriggerSync({ path: { accountId } })
				.then(() => {
					queryClient.invalidateQueries({
						queryKey: mailboxOperationsListMailboxesQueryKey({
							path: { accountId },
						}),
					});
				})
				.catch((err: unknown) => {
					// Fire-and-forget: this is a background staleness probe, the
					// user has no way to react to a failure here. Drop the guard
					// for this account so a later remount can retry.
					triggeredAccountIds.delete(accountId);
					console.warn("[remit] background mailbox sync failed", {
						accountId,
						error: err,
					});
				});
		}
	}, [stableKey, queryClient]);
};
