/**
 * Pure scheduling decision for the periodic mailbox-sync tick (#1247).
 *
 * Two tiers, one rule: an account counts as "online" when it has had
 * authenticated API activity within the online interval (see
 * `AccountService.bumpActivity` / the mailbox-list handler); an online
 * account is due when its last sync is older than the online interval, an
 * offline account when its last sync is older than the (much longer) offline
 * interval. An account that has never synced is always due.
 */

export interface SchedulableAccount {
	readonly accountId: string;
	readonly lastSyncAt?: number;
	readonly lastActivityAt?: number;
}

export interface SchedulerThresholds {
	readonly onlineIntervalMs: number;
	readonly offlineIntervalMs: number;
}

/**
 * Tolerance absorbing the worker's own processing lag between "tick enqueues
 * SYNC_MAILBOXES" and "worker stamps lastSyncAt" (sync-mailboxes.ts, a few
 * seconds after mailbox discovery completes). Without it, a tick firing
 * exactly on the configured interval sees `elapsed` a few seconds short of
 * the threshold and skips — the account then re-syncs only every *other*
 * tick, doubling the effective cadence (review #1250). Subtracted from
 * whichever interval is in effect, so the very next tick after a sync still
 * finds the account due, matching the documented cadence.
 */
export const DUE_SLACK_MS = 60_000;

export const isAccountOnline = (
	account: SchedulableAccount,
	now: number,
	onlineIntervalMs: number,
): boolean => {
	if (!account.lastActivityAt) return false;
	return now - account.lastActivityAt <= onlineIntervalMs;
};

export const isSyncDue = (
	account: SchedulableAccount,
	now: number,
	thresholds: SchedulerThresholds,
): boolean => {
	if (!account.lastSyncAt) return true;

	const { onlineIntervalMs, offlineIntervalMs } = thresholds;
	const intervalMs = isAccountOnline(account, now, onlineIntervalMs)
		? onlineIntervalMs
		: offlineIntervalMs;
	const dueThresholdMs = Math.max(intervalMs - DUE_SLACK_MS, 0);

	return now - account.lastSyncAt >= dueThresholdMs;
};
