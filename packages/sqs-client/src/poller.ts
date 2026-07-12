import {
	DeleteMessageCommand,
	ReceiveMessageCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";
import { AwsQueryProtocol } from "@aws-sdk/core/protocols";
import type {
	Context,
	SQSBatchResponse,
	SQSEvent,
	SQSHandler,
} from "aws-lambda";
import { resolveSqsCredentials } from "./index.js";

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
}

const DEFAULT_MAX_MESSAGES = 10; // SQS API limit
const DEFAULT_VISIBILITY_TIMEOUT_SECONDS = 300;

const buildClient = (queueUrl: string): SQSClient => {
	const isLocal =
		queueUrl.startsWith("http://") || queueUrl.startsWith("https://localhost");
	return new SQSClient({
		endpoint: isLocal ? new URL(queueUrl).origin : undefined,
		...(isLocal && { protocol: AwsQueryProtocol }),
		credentials: resolveSqsCredentials(),
	});
};

const pollTarget = async (
	target: QueuePollerTarget,
	log: QueuePollerLog,
	isShuttingDown: () => boolean,
): Promise<void> => {
	const queueName = new URL(target.queueUrl).pathname.split("/").pop();
	const sqs = buildClient(target.queueUrl);
	const maxMessages = target.maxMessages ?? DEFAULT_MAX_MESSAGES;
	const visibilityTimeout =
		target.visibilityTimeoutSeconds ?? DEFAULT_VISIBILITY_TIMEOUT_SECONDS;
	const lambdaContext = { functionName: target.functionName } as Context;

	log.info({ queue: queueName, maxMessages }, "poller: started");

	// Always long-poll (SQS max WaitTimeSeconds). An empty long poll is free
	// and returns as soon as a message arrives, so this is never slower than
	// short-polling under load — it just stops burning a ReceiveMessage call
	// (and, against real SQS, its cost) every loop iteration while traffic is
	// continuous.
	const LONG_POLL_WAIT_SECONDS = 20;

	while (!isShuttingDown()) {
		const response = await sqs.send(
			new ReceiveMessageCommand({
				QueueUrl: target.queueUrl,
				MaxNumberOfMessages: maxMessages,
				WaitTimeSeconds: LONG_POLL_WAIT_SECONDS,
				VisibilityTimeout: visibilityTimeout,
				MessageSystemAttributeNames: ["ApproximateReceiveCount"],
			}),
		);

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

		log.info(
			{ queue: queueName, count: messages.length },
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

		// Batch is capped at maxMessages (SQS API limit: 10), so a handful of
		// concurrent DeleteMessage calls is safe and avoids paying N sequential
		// round trips between every receive/handler cycle.
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
			},
			"poller: batch processed",
		);
	}

	log.info({ queue: queueName }, "poller: stopped");
};

/**
 * Runs every target's poll loop concurrently until a shutdown signal is
 * received (default: SIGINT, SIGTERM), then lets each loop finish its
 * current iteration and returns. Rejects (crashes the process) if any loop
 * throws — a stuck poller should exit loudly, not degrade silently.
 */
export const runQueuePoller = async (
	options: RunQueuePollerOptions,
): Promise<void> => {
	const { targets, log } = options;
	const signals = options.signals ?? ["SIGINT", "SIGTERM"];

	if (targets.length === 0) {
		throw new Error("runQueuePoller: no targets configured");
	}

	let shuttingDown = false;
	const isShuttingDown = () => shuttingDown;
	const onSignal = (signal: NodeJS.Signals) => {
		log.info({ signal }, "poller: shutdown signal received");
		shuttingDown = true;
	};
	for (const signal of signals) {
		process.on(signal, onSignal);
	}

	log.info({ queues: targets.map((t) => t.queueUrl) }, "poller: starting");

	await Promise.all(
		targets.map((target) => pollTarget(target, log, isShuttingDown)),
	);
};
