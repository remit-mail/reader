import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import {
	DeleteMessageCommand,
	ReceiveMessageCommand,
	type ReceiveMessageCommandOutput,
} from "@aws-sdk/client-sqs";
import type {
	Context,
	SQSBatchResponse,
	SQSEvent,
	SQSHandler,
} from "aws-lambda";
import {
	clearHeartbeats,
	createHeartbeat,
	type Heartbeat,
} from "./heartbeat.js";
import { createQueueProducer } from "./producer.js";

/**
 * Production queue poller — the non-e2e counterpart of the per-worker
 * `e2e-processor-shim.ts` scripts. It receives from an SQS-compatible
 * endpoint (real SQS or ElasticMQ), wraps each batch in an `SQSEvent`, and
 * invokes the exact production Lambda `handler`, honouring
 * `batchItemFailures` the way the SQS service does: delete what succeeded,
 * leave failures for redelivery.
 *
 * Unlike the e2e shim (one child process per queue, via `node:cluster`),
 * this runs every target queue as a concurrent poll loop inside a single
 * process — the right shape for a container whose only job is "poll these
 * queues, invoke this handler, exit on SIGTERM."
 */
export interface QueuePollerLog {
	info: (fields: Record<string, unknown>, message: string) => void;
	error: (fields: Record<string, unknown>, message: string) => void;
}

export interface QueuePollerTarget {
	readonly queueUrl: string;
	readonly handler: SQSHandler;
	/** Reported as the Lambda `Context.functionName` the handler observes. */
	readonly functionName: string;
	readonly maxMessages?: number;
	readonly visibilityTimeoutSeconds?: number;
}

export interface RunQueuePollerOptions {
	readonly targets: readonly QueuePollerTarget[];
	readonly log: QueuePollerLog;
	readonly signals?: readonly NodeJS.Signals[];
	/** One per target. Defaults to a file under `WORKER_HEARTBEAT_PREFIX`. */
	readonly createHeartbeat?: (name: string) => Heartbeat;
}

// One message per receive, not the SQS maximum of 10. Handlers process a batch
// sequentially, so a batch of ten is ten handler runs between two heartbeats:
// ten stalled SMTP sends at nodemailer's 300 s socket timeout is 50 minutes of
// legitimate silence, and a threshold that tolerates it detects nothing. At one
// message the quiet stretch a healthy loop can produce is one handler run, and
// the extra receive per message is a millisecond against the local queue
// sidecar — the same total work either way.
const DEFAULT_MAX_MESSAGES = 1;
/**
 * What a handler has before the queue redelivers the record underneath it.
 * Exported because a handler that budgets its own wait has to agree with it;
 * `deploy/vps/queues.json` sets the same number on the queue itself, and this
 * is the one that applies wherever a target passes no override.
 */
export const DEFAULT_VISIBILITY_TIMEOUT_SECONDS = 300;

const pollTarget = async (
	target: QueuePollerTarget,
	log: QueuePollerLog,
	isShuttingDown: () => boolean,
	shutdownSignal: AbortSignal,
	buildHeartbeat: (name: string) => Heartbeat,
): Promise<void> => {
	const queueName = new URL(target.queueUrl).pathname.split("/").pop();
	const heartbeat = buildHeartbeat(queueName ?? target.functionName);
	const sqs = createQueueProducer({ queueUrl: target.queueUrl });
	const maxMessages = target.maxMessages ?? DEFAULT_MAX_MESSAGES;
	const visibilityTimeout =
		target.visibilityTimeoutSeconds ?? DEFAULT_VISIBILITY_TIMEOUT_SECONDS;
	log.info({ queue: queueName, maxMessages }, "poller: started");

	// Always long-poll (SQS max WaitTimeSeconds). An empty long poll is free
	// and returns as soon as a message arrives, so this is never slower than
	// short-polling under load — it just stops burning a ReceiveMessage call
	// (and, against real SQS, its cost) every loop iteration while traffic is
	// continuous.
	const LONG_POLL_WAIT_SECONDS = 20;

	while (!isShuttingDown()) {
		// Top of the receive attempt, before the long poll: this loop's own file,
		// so a loop that stops turning — wedged in a socket read, or in a handler
		// that never returns — goes stale on its own however busy its siblings are.
		//
		// A write that fails must not take the worker down with it. A full disk is
		// the likeliest cause and the moment the loop should stay up, failing
		// records into the dead-letter queues with logs rather than crash-looping
		// on the monitoring. The missed beat is itself the signal: the healthcheck
		// goes stale, which is what this file exists to report.
		await heartbeat().catch((error) => {
			log.error(
				{ queue: queueName, error: inspect(error) },
				"poller: heartbeat write failed",
			);
		});

		let response: ReceiveMessageCommandOutput;
		try {
			// Abort the receive on shutdown. Without this, a container stopped
			// while idle waits out the current 20s long poll before the loop
			// checks the flag again, and a self-update then burns the whole
			// stop grace on every idle worker — the bulk of the visible restart
			// downtime. The abort ends the in-flight receive at once; an
			// in-flight handler below is never interrupted, so a message being
			// processed still finishes cleanly. The heartbeat above already wrote
			// this iteration, so the abort exits without a further beat.
			response = await sqs.send(
				new ReceiveMessageCommand({
					QueueUrl: target.queueUrl,
					MaxNumberOfMessages: maxMessages,
					WaitTimeSeconds: LONG_POLL_WAIT_SECONDS,
					VisibilityTimeout: visibilityTimeout,
					MessageSystemAttributeNames: ["ApproximateReceiveCount"],
				}),
				{ abortSignal: shutdownSignal },
			);
		} catch (error) {
			if (shutdownSignal.aborted) break;
			throw error;
		}

		if (!response.Messages || response.Messages.length === 0) {
			continue;
		}

		const messages = response.Messages.flatMap((m) =>
			m.Body && m.ReceiptHandle && m.MessageId
				? [
						{
							messageId: m.MessageId,
							receiptHandle: m.ReceiptHandle,
							body: m.Body,
							receiveCount: m.Attributes?.ApproximateReceiveCount ?? "1",
						},
					]
				: [],
		);
		if (messages.length === 0) continue;

		// One batch is one handler invocation, so the id is minted per batch: it is
		// the `requestId` every line of that invocation is grouped by (see
		// deploy/vps/README.md, "Logs"). A context built once per target would put
		// the whole queue's lifetime under one id, which correlates nothing.
		//
		// Minted before the poller's own bracketing lines rather than next to the
		// handler call: grouping on the id has to reach the line saying whether the
		// message was deleted or left for redelivery, which is what someone looks
		// for after a failure.
		const lambdaContext = {
			functionName: target.functionName,
			awsRequestId: randomUUID(),
		} as Context;

		log.info(
			{
				queue: queueName,
				count: messages.length,
				requestId: lambdaContext.awsRequestId,
			},
			"poller: invoking handler",
		);

		const event: SQSEvent = {
			Records: messages.map((m) => ({
				messageId: m.messageId,
				receiptHandle: m.receiptHandle,
				body: m.body,
				attributes: {
					ApproximateReceiveCount: m.receiveCount,
					SentTimestamp: "0",
					SenderId: "poller",
					ApproximateFirstReceiveTimestamp: "0",
				},
				messageAttributes: {},
				md5OfBody: "",
				eventSource: "aws:sqs",
				eventSourceARN: target.queueUrl,
				awsRegion: "local",
			})),
		};

		const result = (await target.handler(event, lambdaContext, () => {})) as
			| SQSBatchResponse
			| undefined;

		const failedIds = new Set(
			(result?.batchItemFailures ?? []).map((f) => f.itemIdentifier),
		);
		const succeeded = messages.filter((m) => !failedIds.has(m.messageId));

		// Batch is capped at maxMessages (one by default, 10 is the SQS ceiling),
		// so a handful of concurrent DeleteMessage calls is safe and avoids paying
		// N sequential round trips between every receive/handler cycle.
		await Promise.all(
			succeeded.map((message) =>
				sqs.send(
					new DeleteMessageCommand({
						QueueUrl: target.queueUrl,
						ReceiptHandle: message.receiptHandle,
					}),
				),
			),
		);

		log.info(
			{
				queue: queueName,
				deleted: succeeded.length,
				leftForRedelivery: failedIds.size,
				requestId: lambdaContext.awsRequestId,
			},
			"poller: batch processed",
		);
	}

	log.info({ queue: queueName }, "poller: stopped");
};

/**
 * received (default: SIGINT, SIGTERM). The signal aborts each loop's in-flight
 * long-poll receive so an idle worker returns at once instead of waiting out
 * the current 20s poll; a loop mid-handler finishes that handler first. Rejects
 * (crashes the process) if any loop throws — a stuck poller should exit loudly,
 * not degrade silently.
 *
 * Every loop writes its own heartbeat file (see heartbeat.ts) at the top of its
 * receive attempt, which is how a loop that hangs instead of throwing — the
 * case this cannot make loud by itself — becomes visible.
 */
export const runQueuePoller = async (
	options: RunQueuePollerOptions,
): Promise<void> => {
	const { targets, log } = options;
	const signals = options.signals ?? ["SIGINT", "SIGTERM"];
	const buildHeartbeat = options.createHeartbeat ?? createHeartbeat;

	if (targets.length === 0) {
		throw new Error("runQueuePoller: no targets configured");
	}

	// Files from the previous run of this service, before its loops write again:
	// the healthcheck reads the oldest file it finds, so one left behind by a
	// queue this version no longer polls would fail the check forever.
	await clearHeartbeats().catch((error) => {
		log.error({ error: inspect(error) }, "poller: heartbeat cleanup failed");
	});

	let shuttingDown = false;
	const isShuttingDown = () => shuttingDown;
	// Aborted alongside the flag so a loop currently blocked in its long-poll
	// receive returns at once, rather than after up to WaitTimeSeconds.
	const shutdown = new AbortController();
	const onSignal = (signal: NodeJS.Signals) => {
		log.info({ signal }, "poller: shutdown signal received");
		shuttingDown = true;
		shutdown.abort();
	};
	for (const signal of signals) {
		process.on(signal, onSignal);
	}

	log.info({ queues: targets.map((t) => t.queueUrl) }, "poller: starting");

	await Promise.all(
		targets.map((target) =>
			pollTarget(target, log, isShuttingDown, shutdown.signal, buildHeartbeat),
		),
	);
};
