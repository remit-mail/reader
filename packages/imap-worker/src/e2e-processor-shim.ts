#!/usr/bin/env node
import cluster from "node:cluster";
import {
	DeleteMessageCommand,
	ReceiveMessageCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";
import { AwsQueryProtocol } from "@aws-sdk/core/protocols";
import { createLogger } from "@remit/logger-lambda";
import { handler as searchIndexHandler } from "@remit/search-index-worker";
import type {
	Context,
	SQSBatchResponse,
	SQSEvent,
	SQSHandler,
} from "aws-lambda";
import { env } from "expect-env";
import { handler } from "./index.js";

/**
 * E2E-only queue drainer.
 *
 * Production binds the Lambda `handler` (`src/index.ts`) to each queue via an
 * SQS event-source mapping. The e2e/CI stack runs on ElasticMQ, which has no
 * event-source mapping, so this process supplies that missing piece: it
 * long-polls each queue, wraps every received batch in an `SQSEvent`, and
 * invokes the exact production `handler`. It then honours the returned
 * `batchItemFailures` the way the SQS service would — deleting the messages
 * that succeeded and leaving the failures un-deleted so their visibility
 * timeout lapses and SQS redelivers them. No processing or failure logic lives
 * here; the prod handler owns all of it.
 *
 * This is a test harness, not production code. If it crashes the e2e suite
 * fails loudly, which is the desired signal — there is no crash net.
 */

// The search-index queue is drained by the production search-index-worker
// handler instead of the imap handler. It is optional: when its URL is unset
// (e.g. the e2e stack), the queue is simply not polled.
const searchIndexQueueUrl = process.env.SQS_QUEUE_URL_SEARCH_INDEX;

// Collect all unique queue URLs to poll. Every required queue URL crashes at
// init via expect-env instead of silently dropping queues.
const queueUrls = [
	...new Set([
		// FIFO queues for sync operations
		env.SQS_QUEUE_URL_MAILBOXES,
		env.SQS_QUEUE_URL_MESSAGES,
		env.SQS_QUEUE_URL_FLAGS,
		// Standard body queue (#612) + management queues
		env.SQS_QUEUE_URL_BODY,
		env.SQS_QUEUE_URL_MAILBOX_MGMT,
		env.SQS_QUEUE_URL_MESSAGE_MGMT,
		// Standard queue for local search indexing (optional)
		...(searchIndexQueueUrl ? [searchIndexQueueUrl] : []),
	]),
];

if (cluster.isPrimary) {
	// Primary process: fork a worker for each queue
	const log = createLogger();
	log.info({ queueUrls, workerCount: queueUrls.length }, "Primary started");

	// Track which queue each worker handles for restart
	const workerQueues = new Map<number, string>();

	// Fork a worker for each queue
	for (const queueUrl of queueUrls) {
		const worker = cluster.fork({ WORKER_QUEUE_URL: queueUrl });
		workerQueues.set(worker.id, queueUrl);
		const queueName = new URL(queueUrl).pathname.split("/").pop();
		log.info({ workerId: worker.id, queueName }, "Forked worker for queue");
	}

	// Restart workers that crash
	cluster.on("exit", (worker, code, signal) => {
		const queueUrl = workerQueues.get(worker.id);
		const queueName = queueUrl
			? new URL(queueUrl).pathname.split("/").pop()
			: "unknown";

		if (signal) {
			log.info({ workerId: worker.id, queueName, signal }, "Worker killed");
		} else if (code !== 0) {
			log.error(
				{ workerId: worker.id, queueName, code },
				"Worker crashed, exiting primary",
			);
			process.exit(1);
		} else {
			log.info({ workerId: worker.id, queueName }, "Worker exited cleanly");
			workerQueues.delete(worker.id);
		}
	});

	// Graceful shutdown: signal all workers
	const shutdown = () => {
		log.info("Primary received shutdown signal, stopping workers...");
		for (const worker of Object.values(cluster.workers ?? {})) {
			worker?.process.kill("SIGTERM");
		}
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
} else {
	// Worker process: poll a single queue
	const queueUrl = env.WORKER_QUEUE_URL;
	const queueName = new URL(queueUrl).pathname.split("/").pop();
	const log = createLogger().child({ queue: queueName });

	// The search-index queue carries DynamoDB-stream-shaped events and is owned
	// by the search-index-worker handler; every other queue is an imap operation.
	const activeHandler: SQSHandler =
		queueUrl === searchIndexQueueUrl ? searchIndexHandler : handler;

	const maxMessages = 10; // SQS API limit

	const isLocal = queueUrl.startsWith("http://localhost");
	const sqs = new SQSClient({
		endpoint: isLocal ? new URL(queueUrl).origin : undefined,
		...(isLocal && { protocol: AwsQueryProtocol }),
	});

	let isShuttingDown = false;

	process.on("SIGINT", () => {
		log.info("Worker received SIGINT, shutting down...");
		isShuttingDown = true;
	});

	process.on("SIGTERM", () => {
		log.info("Worker received SIGTERM, shutting down...");
		isShuttingDown = true;
	});

	// Minimal Lambda Context: `withTelemetry` only reads `functionName` and adds
	// it to the logger; the prod handler never touches the rest.
	const lambdaContext = {
		functionName: `e2e-imap-worker-${queueName}`,
	} as Context;

	const pollQueue = async (): Promise<void> => {
		log.info({ maxMessages }, "Worker started, polling...");

		let consecutiveEmptyPolls = 0;

		while (!isShuttingDown) {
			// Use short polling when we just processed messages (likely more waiting)
			// Use long polling after empty polls to reduce API calls
			const waitTime = consecutiveEmptyPolls > 0 ? 20 : 0;

			const response = await sqs.send(
				new ReceiveMessageCommand({
					QueueUrl: queueUrl,
					MaxNumberOfMessages: maxMessages,
					WaitTimeSeconds: waitTime,
					VisibilityTimeout: 300,
					MessageSystemAttributeNames: ["ApproximateReceiveCount"],
				}),
			);

			if (!response.Messages || response.Messages.length === 0) {
				consecutiveEmptyPolls++;
				continue;
			}

			consecutiveEmptyPolls = 0;

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

			if (messages.length === 0) {
				continue;
			}

			log.info({ count: messages.length }, "Invoking handler for batch");

			const event: SQSEvent = {
				Records: messages.map((m) => ({
					messageId: m.messageId,
					receiptHandle: m.receiptHandle,
					body: m.body,
					attributes: {
						ApproximateReceiveCount: m.receiveCount,
						SentTimestamp: "0",
						SenderId: "e2e",
						ApproximateFirstReceiveTimestamp: "0",
					},
					messageAttributes: {},
					md5OfBody: "",
					eventSource: "aws:sqs",
					eventSourceARN: queueUrl,
					awsRegion: "local",
				})),
			};

			const result = (await activeHandler(event, lambdaContext, () => {})) as
				| SQSBatchResponse
				| undefined;

			const failedIds = new Set(
				(result?.batchItemFailures ?? []).map((f) => f.itemIdentifier),
			);

			// Mirror SQS partial-batch-failure semantics: delete the messages the
			// handler reported as succeeded; leave failures un-deleted so their
			// visibility timeout lapses and SQS redelivers them (and eventually
			// dead-letters once maxReceiveCount is hit).
			const succeeded = messages.filter((m) => !failedIds.has(m.messageId));

			for (const message of succeeded) {
				await sqs.send(
					new DeleteMessageCommand({
						QueueUrl: queueUrl,
						ReceiptHandle: message.receiptHandle,
					}),
				);
			}

			log.info(
				{ deleted: succeeded.length, leftForRedelivery: failedIds.size },
				"Batch processed",
			);
		}

		log.info("Worker polling stopped");
	};

	pollQueue()
		.then(() => process.exit(0))
		.catch((error) => {
			log.error({ error }, "Worker error");
			process.exit(1);
		});
}
