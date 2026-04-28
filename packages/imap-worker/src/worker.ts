#!/usr/bin/env node
import cluster from "node:cluster";
import { inspect } from "node:util";
import {
	DeleteMessageCommand,
	ReceiveMessageCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";
import { AwsQueryProtocol } from "@aws-sdk/core/protocols";
import { createLogger } from "@remit/remit-logger-lambda";
import { env } from "expect-env";
import pMap from "p-map";
import type { WorkerEvent } from "./events.js";
import { processEvent } from "./processor.js";

// Collect all unique queue URLs to poll. Every queue URL is required; missing
// env vars crash at init via expect-env instead of silently dropping queues.
const queueUrls = [
	...new Set([
		// FIFO queues for sync operations
		env.SQS_QUEUE_URL_MAILBOXES,
		env.SQS_QUEUE_URL_MESSAGES,
		env.SQS_QUEUE_URL_BODY,
		env.SQS_QUEUE_URL_FLAGS,
		// Standard queues for management operations
		env.SQS_QUEUE_URL_MAILBOX_MGMT,
		env.SQS_QUEUE_URL_MESSAGE_MGMT,
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

	// Per-queue concurrency: WORKER_MAX_CONCURRENCY_<QUEUE_SUFFIX> (e.g., WORKER_MAX_CONCURRENCY_BODY)
	// Falls back to global WORKER_MAX_CONCURRENCY, then default of 10
	const queueSuffix = queueName
		?.replace("remit-", "")
		.replace(".fifo", "")
		.toUpperCase();
	const perQueueConcurrency = queueSuffix
		? Number(process.env[`WORKER_MAX_CONCURRENCY_${queueSuffix}`])
		: NaN;
	const globalConcurrency = Number(process.env.WORKER_MAX_CONCURRENCY) || 10;
	const maxConcurrency = Number.isNaN(perQueueConcurrency)
		? globalConcurrency
		: perQueueConcurrency;
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

	process.on("unhandledRejection", (reason, promise) => {
		console.error("Unhandled Rejection at:", promise, "reason:", reason);
	});

	process.on("uncaughtException", (err) => {
		console.error("Uncaught Exception:", err);
		process.exit(1);
	});

	const processMessage = async (
		messageBody: string,
		receiptHandle: string,
	): Promise<void> => {
		const event = JSON.parse(messageBody) as WorkerEvent;
		log.info({ event }, "Processing event");

		await processEvent(event, log);

		await sqs.send(
			new DeleteMessageCommand({
				QueueUrl: queueUrl,
				ReceiptHandle: receiptHandle,
			}),
		);

		log.info(
			{ eventId: "eventId" in event ? event.eventId : undefined },
			"Event processed and deleted",
		);
	};

	const pollQueue = async (): Promise<void> => {
		log.info({ maxConcurrency, maxMessages }, "Worker started, polling...");

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
				}),
			);

			if (!response.Messages || response.Messages.length === 0) {
				consecutiveEmptyPolls++;
				continue;
			}

			consecutiveEmptyPolls = 0;

			const validMessages = response.Messages.flatMap((m) =>
				m.Body && m.ReceiptHandle
					? [
							{
								body: m.Body,
								receiptHandle: m.ReceiptHandle,
								messageId: m.MessageId,
							},
						]
					: [],
			);

			if (validMessages.length === 0) {
				continue;
			}

			log.info({ count: validMessages.length }, "Processing messages");

			await pMap(
				validMessages,
				(message) =>
					processMessage(message.body, message.receiptHandle).catch((error) => {
						console.error(inspect(error));
						log.error(
							{
								error,
								stack: (error as Error).stack,
								messageId: message.messageId,
							},
							"Failed to process message",
						);
					}),
				{ concurrency: maxConcurrency },
			);
		}

		log.info("Worker polling stopped");
	};

	pollQueue()
		.then(() => process.exit(0))
		.catch((error) => {
			console.error("Worker error:", error);
			process.exit(1);
		});
}
