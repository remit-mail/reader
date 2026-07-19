import { getClient } from "@remit/backend/client";
import { createLogger, withTelemetry } from "@remit/logger-lambda";
import { createQueueProducer } from "@remit/sqs-client/producer";
import type { ScheduledHandler } from "aws-lambda";
import { env } from "expect-env";
import { getOfflineIntervalMs, getTickIntervalMs } from "./config.js";
import { runSchedulerTick } from "./run-tick.js";

const log = createLogger();

const mailboxesQueueUrl = env.SQS_QUEUE_URL_MAILBOXES;
const sqsClient = createQueueProducer({ queueUrl: mailboxesQueueUrl });

/**
 * EventBridge-scheduled entry point for the periodic mailbox-sync tick
 * (#1247, restructured #1251). Ticks at `MAILBOX_SYNC_TICK_INTERVAL_SECONDS`
 * (rate schedule, wired in infra/stacks/dev/stacks/remit-worker-stack.ts) and
 * delegates the actual decision + enqueue to `runSchedulerTick` — the same
 * function the local dev-stack timer loop calls (see `local-runner.ts`), so
 * production and local dev run one code path.
 *
 * Uses the EventBridge event's own `time` (the scheduled fire time) as the
 * tick's `now`, rather than `Date.now()` at processing time. This is what
 * keeps `buildScheduledSyncDedupId`'s time bucket aligned to the schedule
 * instead of wall-clock/Lambda-cold-start jitter (review #1250): every
 * distinct scheduled firing gets a `time` exactly `tickIntervalMs` apart
 * from the last, so consecutive ticks always land in different buckets,
 * while a genuine retry of the same invocation carries the same `time` and
 * correctly dedupes.
 */
export const handler: ScheduledHandler = withTelemetry(async (event) => {
	const { account } = await getClient();
	const now = Date.parse(event.time);

	await runSchedulerTick({
		accountService: account,
		sqsClient,
		queueUrl: mailboxesQueueUrl,
		log,
		tickIntervalMs: getTickIntervalMs(),
		offlineIntervalMs: getOfflineIntervalMs(),
		now,
	});
});
