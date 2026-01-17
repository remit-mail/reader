#!/usr/bin/env node
import { inspect } from "node:util";
import {
	DeleteMessageCommand,
	ReceiveMessageCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";
import { createLogger } from "@remit/logger-lambda";
import { env } from "expect-env";
import type { ImapEvent } from "./events.js";
import { processEvent } from "./processor.js";

const defaultQueueUrl = env.SQS_QUEUE_URL;

// Collect all unique queue URLs to poll
const queueUrls = [
	...new Set(
		[
			defaultQueueUrl,
			process.env.SQS_QUEUE_URL_MAILBOXES,
			process.env.SQS_QUEUE_URL_MESSAGES,
			process.env.SQS_QUEUE_URL_BODY,
		].filter((url): url is string => Boolean(url)),
	),
];

// SQS ReceiveMessage API max is 10 per call
// Lambda achieves higher throughput via concurrent invocations
// For local dev, we poll continuously and process in parallel
const maxConcurrency = Number(process.env.WORKER_MAX_CONCURRENCY) || 10;
const maxMessages = 10; // SQS API limit

const sqs = new SQSClient({
	endpoint: defaultQueueUrl.startsWith("http://localhost")
		? new URL(defaultQueueUrl).origin
		: undefined,
});
const log = createLogger();

let isShuttingDown = false;

process.on("SIGINT", () => {
	log.info("Received SIGINT, shutting down gracefully...");
	isShuttingDown = true;
});

process.on("SIGTERM", () => {
	log.info("Received SIGTERM, shutting down gracefully...");
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
	queueUrl: string,
	messageBody: string,
	receiptHandle: string,
): Promise<void> => {
	const event = JSON.parse(messageBody) as ImapEvent;
	log.info({ event }, "Processing event from queue");

	await processEvent(event, log);

	await sqs.send(
		new DeleteMessageCommand({
			QueueUrl: queueUrl,
			ReceiptHandle: receiptHandle,
		}),
	);

	log.info(
		{ eventId: event.eventId },
		"Event processed and deleted from queue",
	);
};

const processWithConcurrencyLimit = async <T>(
	items: T[],
	concurrency: number,
	fn: (item: T) => Promise<void>,
): Promise<void> => {
	const executing: Promise<void>[] = [];

	for (const item of items) {
		const promise = fn(item).then(() => {
			executing.splice(executing.indexOf(promise), 1);
		});
		executing.push(promise);

		if (executing.length >= concurrency) {
			await Promise.race(executing);
		}
	}

	await Promise.all(executing);
};

const pollQueue = async (queueUrl: string): Promise<void> => {
	const queueName = new URL(queueUrl).pathname.split("/").pop();
	log.info(
		{ queueUrl, queueName, maxConcurrency, maxMessages },
		"Polling queue...",
	);

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

		log.info(
			{ queueName, count: validMessages.length },
			"Processing messages in parallel",
		);

		await processWithConcurrencyLimit(
			validMessages,
			maxConcurrency,
			async (message) => {
				await processMessage(
					queueUrl,
					message.body,
					message.receiptHandle,
				).catch((error) => {
					console.error(inspect(error));
					log.error(
						{
							error,
							stack: (error as Error).stack,
							messageId: message.messageId,
						},
						"Failed to process message",
					);
				});
			},
		);
	}

	log.info({ queueName }, "Queue polling stopped");
};

log.info({ queueUrls }, "Worker started, polling queues...");

Promise.all(queueUrls.map((url) => pollQueue(url)))
	.then(() => process.exit(0))
	.catch((error) => {
		console.error("Worker error:", error);
		process.exit(1);
	});
