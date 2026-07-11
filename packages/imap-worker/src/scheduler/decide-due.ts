/**
 * Pure scheduling decision for the periodic mailbox-sync tick (#1247,
 * restructured #1251).
 *
 * One tier: an account is due once its last successful sync is older than
 * `offlineIntervalMs`. An account that has never synced is always due. The
 * tick interval is decoupled from this threshold and runs far more often
 * than `offlineIntervalMs` (see config.ts), so — unlike the prior two-tier
 * design — no slack is needed to compensate for sampling lag: a tick that
 * misses an account by a few seconds simply catches it on the next tick,
 * which arrives long before the threshold matters again.
 */

export interface SchedulableAccount {
	readonly accountId: string;
	readonly lastSyncAt?: number;
}

export const isSyncDue = (
	account: SchedulableAccount,
	now: number,
	offlineIntervalMs: number,
): boolean => {
	if (!account.lastSyncAt) return true;
	return now - account.lastSyncAt >= offlineIntervalMs;
};
