#!/usr/bin/env node
import { setTimeout as delay } from "node:timers/promises";
import { getClient } from "@remit/backend/client";
import { createLogger } from "@remit/logger-lambda";
import { clearHeartbeats, createHeartbeat } from "@remit/sqs-client/heartbeat";
import { createQueueProducer } from "@remit/sqs-client/producer";
import { env } from "expect-env";
import { getOfflineIntervalMs, getTickIntervalMs } from "./config.js";
import { runSchedulerTick } from "./run-tick.js";

/**
 * The scheduled-sync runner for every deployment that has no EventBridge: the
 * self-host stack's `scheduler` service and the local dev compose stack. A
 * managed deployment fires `runSchedulerTick` off an EventBridge schedule (see
 * handler.ts); this process ticks the same function on a plain loop at the same
 * `MAILBOX_SYNC_TICK_INTERVAL_SECONDS` cadence, so there is one scheduling
 * implementation and one set of knobs.
 *
 * A tick failure crashes the process loudly rather than being swallowed —
 * compose's `restart: unless-stopped` brings it back for the next tick.
 *
 * The loop rewrites a heartbeat file before each tick, the same signal and the
 * same mechanism as a worker's poll loop (D1 of
 * docs/design/standalone-observability.md). It is not the same claim: a poll
 * loop's file says it is still receiving, and this one says the timer is still
 * firing. Neither says the work succeeded — the accounts that came due are
 * enqueued for workers to fetch, and whether that fetch lands is what
 * `remit_account_sync_age_seconds` measures. A tick that throws exits the
 * process, so a stale file here means the loop wedged inside a call that never
 * returned, which is the failure `restart: unless-stopped` cannot see.
 */

const log = createLogger();

const mailboxesQueueUrl = env.SQS_QUEUE_URL_MAILBOXES;
const sqsClient = createQueueProducer({ queueUrl: mailboxesQueueUrl });

const tickIntervalMs = getTickIntervalMs();
const offlineIntervalMs = getOfflineIntervalMs();

// A persistent failure (e.g. Postgres not up yet at container boot) throws
// before the loop ever reaches its own `delay`, so `restart: unless-stopped`
// would otherwise respawn the process immediately — a tight, log-flooding
// crash loop (review #1250). This fixed pause before exiting is not retry
// logic (there is nothing to retry here; the container restart IS the
// retry) — it only paces how fast that restart can happen.
const CRASH_BACKOFF_MS = 5_000;

log.info(
	{ tickIntervalMs, offlineIntervalMs },
	"Scheduled-sync runner started",
);

const runLoop = async (): Promise<void> => {
	await clearHeartbeats();
	const heartbeat = createHeartbeat("tick");
	const { account } = await getClient();
	for (;;) {
		// A write that fails must not take the scheduler down with it: a full disk
		// is the likeliest cause and the moment mail should keep being enqueued.
		// The missed beat is itself the signal.
		await heartbeat().catch((error) => {
			log.error({ error }, "Scheduled-sync heartbeat write failed");
		});
		await runSchedulerTick({
			accountService: account,
			sqsClient,
			queueUrl: mailboxesQueueUrl,
			log,
			tickIntervalMs,
			offlineIntervalMs,
		});
		await delay(tickIntervalMs);
	}
};

runLoop()
	.catch(async (error) => {
		log.error({ error }, "Scheduled-sync tick failed");
		await delay(CRASH_BACKOFF_MS);
	})
	.finally(() => {
		process.exit(1);
	});
