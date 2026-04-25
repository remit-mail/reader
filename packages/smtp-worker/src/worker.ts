#!/usr/bin/env node
import { inspect } from "node:util";
import {
	DeleteMessageCommand,
	ReceiveMessageCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";
import { AwsQueryProtocol } from "@aws-sdk/core/protocols";
import { createLogger } from "@remit/logger-lambda";
import { env } from "expect-env";
import pMap from "p-map";
import type { SmtpEvent } from "./events.js";
import { processEvent } from "./processor.js";

const queueUrl = env.SQS_QUEUE_URL_SMTP;
const queueName = new URL(queueUrl).pathname.split("/").pop();
const log = createLogger().child({ queue: queueName });

const isLocal = queueUrl.startsWith("http://localhost");
const sqs = new SQSClient({
	endpoint: isLocal ? new URL(queueUrl).origin : undefined,
	...(isLocal && { protocol: AwsQueryProtocol }),
});

const maxConcurrency = Number(process.env.WORKER_MAX_CONCURRENCY) || 10;
const maxMessages = 10;

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
	const event = JSON.parse(messageBody) as SmtpEvent;
	log.info({ event }, "Processing event");

	await processEvent(event, log);

	await sqs.send(
		new DeleteMessageCommand({
			QueueUrl: queueUrl,
			ReceiptHandle: receiptHandle,
		}),
	);

	log.info({ eventId: event.eventId }, "Event processed and deleted");
};

const pollQueue = async (): Promise<void> => {
	log.info({ maxConcurrency, maxMessages }, "Worker started, polling...");

	let consecutiveEmptyPolls = 0;

	while (!isShuttingDown) {
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
