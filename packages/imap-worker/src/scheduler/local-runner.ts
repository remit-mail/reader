#!/usr/bin/env node
import { setTimeout as delay } from "node:timers/promises";
import { SQSClient } from "@aws-sdk/client-sqs";
import { AwsQueryProtocol } from "@aws-sdk/core/protocols";
import { getClient } from "@remit/backend/client";
import { createLogger } from "@remit/logger-lambda";
import { resolveSqsCredentials } from "@remit/sqs-client";
import { env } from "expect-env";
import { getOfflineIntervalMs, getOnlineIntervalMs } from "./config.js";
import { runSchedulerTick } from "./run-tick.js";

/**
 * Standalone scheduled-sync runner for the local pg-dev docker-compose stack
 * (#1247). Production ticks `runSchedulerTick` off an EventBridge schedule
 * (see handler.ts); ElasticMQ/the pg-dev stack has no EventBridge, so this
 * process ticks on a plain loop at the same online-tier cadence instead —
 * same function, same config knobs (MAILBOX_SYNC_ONLINE_INTERVAL_SECONDS /
 * MAILBOX_SYNC_OFFLINE_INTERVAL_SECONDS), so local dev behaves like
 * production rather than needing its own scheduling logic.
 *
 * This is a dev-only harness, not production code: like
 * `e2e-processor-shim.ts`, a tick failure crashes the process loudly rather
 * than swallowing it — docker-compose's `restart: unless-stopped` brings it
 * back for the next tick.
 */

const log = createLogger();

const mailboxesQueueUrl = env.SQS_QUEUE_URL_MAILBOXES;
const isLocal = mailboxesQueueUrl.startsWith("http://localhost");

const sqsClient = new SQSClient({
	endpoint: isLocal ? new URL(mailboxesQueueUrl).origin : undefined,
	...(isLocal && { protocol: AwsQueryProtocol }),
	credentials: resolveSqsCredentials(),
});

const onlineIntervalMs = getOnlineIntervalMs();
const offlineIntervalMs = getOfflineIntervalMs();

// A persistent failure (e.g. Postgres not up yet at container boot) throws
// before the loop ever reaches its own `delay`, so `restart: unless-stopped`
// would otherwise respawn the process immediately — a tight, log-flooding
// crash loop (review #1250). This fixed pause before exiting is not retry
// logic (there is nothing to retry here; the container restart IS the
// retry) — it only paces how fast that restart can happen.
const CRASH_BACKOFF_MS = 5_000;

log.info(
	{ onlineIntervalMs, offlineIntervalMs },
	"Local scheduled-sync runner started",
);

const runLoop = async (): Promise<void> => {
	for (;;) {
		const { account } = await getClient();
		await runSchedulerTick({
			accountService: account,
			sqsClient,
			queueUrl: mailboxesQueueUrl,
			log,
			onlineIntervalMs,
			offlineIntervalMs,
		});
		await delay(onlineIntervalMs);
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
