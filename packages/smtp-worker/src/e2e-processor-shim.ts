#!/usr/bin/env node
import {
	DeleteMessageCommand,
	ReceiveMessageCommand,
} from "@aws-sdk/client-sqs";
import { createLogger } from "@remit/logger-lambda";
import { createQueueProducer } from "@remit/sqs-client/producer";
import type { Context, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { env } from "expect-env";
import { handler } from "./index.js";

/**
 * E2E-only queue drainer.
 *
 * Production binds the Lambda `handler` (`src/index.ts`) to the SMTP queue via
 * an SQS event-source mapping. The e2e/CI stack runs on ElasticMQ, which has no
 * event-source mapping, so this process supplies that missing piece: it
 * long-polls the queue, wraps every received batch in an `SQSEvent`, and invokes
 * the exact production `handler`. It then honours the returned
 * `batchItemFailures` the way the SQS service would — deleting the messages
 * that succeeded and leaving the failures un-deleted so their visibility
 * timeout lapses and SQS redelivers them. No processing or failure logic lives
 * here; the prod handler owns all of it.
 *
 * This is a test harness, not production code. If it crashes the e2e suite
 * fails loudly, which is the desired signal — there is no crash net.
 */

const queueUrl = env.SQS_QUEUE_URL_SMTP;
const queueName = new URL(queueUrl).pathname.split("/").pop();
const log = createLogger().child({ queue: queueName });

const sqs = createQueueProducer({ queueUrl });

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

// Minimal Lambda Context: `withTelemetry` only reads `functionName` and adds it
// to the logger; the prod handler never touches the rest.
const lambdaContext = {
	functionName: `e2e-smtp-worker-${queueName}`,
} as Context;

const pollQueue = async (): Promise<void> => {
	log.info("Worker started, polling...", { maxMessages });

	let consecutiveEmptyPolls = 0;

	while (!isShuttingDown) {
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

		log.info("Invoking handler for batch", { count: messages.length });

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

		const result = (await handler(event, lambdaContext)) as
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

		log.info("Batch processed", {
			deleted: succeeded.length,
			leftForRedelivery: failedIds.size,
		});
	}

	log.info("Worker polling stopped");
};

pollQueue()
	.then(() => process.exit(0))
	.catch((error) => {
		log.error("Worker error", { error });
		process.exit(1);
	});
