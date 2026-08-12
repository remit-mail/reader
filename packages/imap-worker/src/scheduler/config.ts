/**
 * Periodic mailbox-sync scheduler (#1247, restructured #1251): the tick rate
 * and the offline-sync threshold are separate, independently configured
 * knobs — never hardcode a cadence — following the repo's
 * env-var-with-a-safe-default convention (see `METRICS_PORT` in
 * remit-logger-lambda/src/metrics.ts).
 *
 * `tickIntervalSeconds` drives how often the tick itself runs — the
 * EventBridge schedule rate on a managed deployment, the runner's loop delay
 * everywhere else — and must stay well below `offlineIntervalSeconds` so a tick
 * reliably observes every account crossing the threshold. CDK and this runtime
 * default must agree — see infra/lib/config.ts's `mailboxSync` stage config.
 *
 * `offlineIntervalSeconds` is the only due-ness threshold: an account is due
 * once its last successful sync is older than this interval. There is no
 * "online" tier — client-side polling (useStaleAccountSync) covers an
 * account while its mail is actively open in the web client.
 *
 * The defaults below are a floor for a deployment that sets neither. The
 * standalone stack sets both, at a cadence sized for one box and a handful of
 * accounts, and the checker's stall threshold is derived from those values —
 * see deploy/vps/docker-compose.sqlite.yml's `scheduler` service.
 */

const DEFAULT_TICK_INTERVAL_SECONDS = 60 * 60; // 1 hour
const DEFAULT_OFFLINE_INTERVAL_SECONDS = 12 * 60 * 60; // 12 hours

const parsePositiveIntSeconds = (
	raw: string | undefined,
	fallback: number,
): number => {
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const getTickIntervalMs = (
	env: NodeJS.ProcessEnv = process.env,
): number =>
	parsePositiveIntSeconds(
		env.MAILBOX_SYNC_TICK_INTERVAL_SECONDS,
		DEFAULT_TICK_INTERVAL_SECONDS,
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
