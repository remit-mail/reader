import { getClient } from "@remit/backend/client";
import { createLogger } from "@remit/logger";
import { installNodeLogger, withTelemetry } from "@remit/logger-lambda/node";
import type { ScheduledHandler } from "aws-lambda";
import { lambdaEmitEvent } from "../lambda-context.js";
import type { WorkerQueues } from "../queues.js";
import { sqsWorkerQueues, workerQueueUrlsFromEnv } from "../sqs-queues.js";
import { buildAttachmentSweep } from "./attachment-sweep.js";
import { buildCalendarSubscriptionRefresh } from "./calendar-subscriptions.js";
import { getOfflineIntervalMs, getTickIntervalMs } from "./config.js";
import { runSchedulerTick } from "./run-tick.js";
import { redriveStrandedPlacements } from "./stranded-placement-redrive.js";

installNodeLogger();

const log = createLogger();

/**
 * EventBridge-scheduled entry point for the periodic mailbox-sync tick
 * (#1247, restructured #1251). Ticks at `MAILBOX_SYNC_TICK_INTERVAL_SECONDS`
 * (rate schedule, wired in infra/stacks/dev/stacks/remit-worker-stack.ts) and
 * delegates the actual decision + enqueue to `runSchedulerTick` — the same
 * function the timer loop calls on a deployment with no EventBridge (see
 * `runner.ts`), so every deployment runs one code path.
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
export const buildScheduledHandler = (queues: WorkerQueues): ScheduledHandler =>
	withTelemetry(async (event) => {
		const client = await getClient();
		const now = Date.parse(event.time);

		await runSchedulerTick({
			accountService: client.account,
			queue: queues.mailboxes,
			log,
			tickIntervalMs: getTickIntervalMs(),
			offlineIntervalMs: getOfflineIntervalMs(),
			now,
			// The hosted side is the one that needs this: a browser PUTs straight
			// to block storage, so nothing refuses an upload against a draft that is
			// already gone and this sweep is the only thing that collects it.
			sweepAttachments: buildAttachmentSweep(client, log),
			refreshCalendarSubscriptions: buildCalendarSubscriptionRefresh(
				client,
				log,
			),
			redriveStrandedPlacements: (account, tickNow) =>
				redriveStrandedPlacements(
					{
						client,
						emit: lambdaEmitEvent(queues, client.mailboxLock),
						log,
					},
					account,
					tickNow,
				),
		});
	});

export const handler: ScheduledHandler = buildScheduledHandler(
	sqsWorkerQueues(workerQueueUrlsFromEnv()),
);
