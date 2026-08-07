#!/usr/bin/env node
import { setTimeout as delay } from "node:timers/promises";
import { getClient } from "@remit/backend/client";
import { createLogger } from "@remit/logger-lambda";
import { clearHeartbeats, createHeartbeat } from "@remit/sqs-client/heartbeat";
import { createQueueProducer } from "@remit/sqs-client/producer";
import { sweepAbandonedOutboxAttachments } from "@remit/storage-service";
import { env } from "expect-env";
import { getOfflineIntervalMs, getTickIntervalMs } from "./config.js";
import { runSchedulerLoop } from "./loop.js";
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
 * Liveness is a heartbeat file, the same mechanism as a worker's poll loop (D1
 * of docs/design/standalone-observability.md); loop.ts carries where in the loop
 * it is written and why. Clearing the previous generation's file here is what
 * extends that answer across a restart. A completed round is still not the same
 * as mail arriving: the accounts that came due are enqueued for workers to
 * fetch, and whether that fetch lands is what
 * `remit_account_sync_age_seconds` measures.
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
	// Neither call on the monitoring file may take the scheduler down with it. An
	// unreadable or full /data/heartbeat is a reason to keep enqueuing mail, not
	// to stop. A clear that fails leaves the previous generation's file, which
	// ages out at the same threshold; a write that fails is the missed beat that
	// is itself the signal. Two messages because they are different problems: one
	// is a volume this container could not read at boot, the other a write it
	// could not make this round.
	const onClearError = (error: unknown): void => {
		log.error({ error }, "Scheduled-sync heartbeat clear failed");
	};
	const onBeatError = (error: unknown): void => {
		log.error({ error }, "Scheduled-sync heartbeat write failed");
	};

	await clearHeartbeats().catch(onClearError);
	const { account, storage } = await getClient();
	await runSchedulerLoop({
		tick: runSchedulerTick,
		tickDeps: {
			accountService: account,
			sqsClient,
			queueUrl: mailboxesQueueUrl,
			log,
			tickIntervalMs,
			offlineIntervalMs,
			sweepAttachments: async (item) => {
				const { deleted } = await sweepAbandonedOutboxAttachments(
					storage,
					item.accountConfigId,
					item.accountId,
					Math.floor(Date.now() / 1000),
				);
				if (deleted > 0) {
					log.warn(
						{ accountId: item.accountId, deleted },
						"Collected outbox attachment bytes no ledger vouched for",
					);
				}
			},
		},
		heartbeat: createHeartbeat("tick"),
		onHeartbeatError: onBeatError,
		tickIntervalMs,
	});
};

runLoop()
	.catch(async (error) => {
		log.error({ error }, "Scheduled-sync tick failed");
		await delay(CRASH_BACKOFF_MS);
	})
	.finally(() => {
		process.exit(1);
	});
