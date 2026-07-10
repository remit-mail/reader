/**
 * Scheduled-sync tiers (#1247): every account gets a full mailbox sync on a
 * schedule even with no client polling ("offline" tier); an account with
 * recent authenticated API activity gets refreshed on a much shorter
 * "online" tier instead. Both intervals are config-driven — never hardcode a
 * cadence — following the repo's env-var-with-a-safe-default convention (see
 * `ACCOUNT_DELETION_GRACE_SECONDS` in remit-account-worker/src/config.ts).
 *
 * The online interval also drives the EventBridge schedule rate in
 * infra (the tick cannot run more often than the rate it's invoked at), so
 * CDK and this runtime default must agree — see
 * infra/lib/config.ts's `mailboxSync` stage config.
 */

const DEFAULT_ONLINE_INTERVAL_SECONDS = 5 * 60; // 5 minutes
const DEFAULT_OFFLINE_INTERVAL_SECONDS = 12 * 60 * 60; // 12 hours

const parsePositiveIntSeconds = (
	raw: string | undefined,
	fallback: number,
): number => {
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const getOnlineIntervalMs = (
	env: NodeJS.ProcessEnv = process.env,
): number =>
	parsePositiveIntSeconds(
		env.MAILBOX_SYNC_ONLINE_INTERVAL_SECONDS,
		DEFAULT_ONLINE_INTERVAL_SECONDS,
	) * 1000;

export const getOfflineIntervalMs = (
	env: NodeJS.ProcessEnv = process.env,
): number =>
	parsePositiveIntSeconds(
		env.MAILBOX_SYNC_OFFLINE_INTERVAL_SECONDS,
		DEFAULT_OFFLINE_INTERVAL_SECONDS,
	) * 1000;

// Page size + enqueue concurrency are implementation details of the tick
// itself, not stage config — unlike the two intervals above, nothing outside
// this worker needs to agree with them.
export const SCHEDULER_PAGE_SIZE = 100;
export const SCHEDULER_ENQUEUE_CONCURRENCY = 10;
