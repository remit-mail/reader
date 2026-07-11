import {
	DeleteMessageCommand,
	ReceiveMessageCommand,
	type ReceiveMessageCommandOutput,
	SQSClient,
} from "@aws-sdk/client-sqs";
import { AwsQueryProtocol } from "@aws-sdk/core/protocols";
import type { Logger } from "@remit/remit-logger-lambda";
import { resolveSqsCredentials } from "@remit/sqs-client";
import type { SQSRecord } from "aws-lambda";
import { type IndexOutcome, processBatch } from "./handler.js";
import { createIndexWorkStats, type IndexWorkStats } from "./index-stats.js";
import { parseQueueMessage } from "./parse.js";
import type { Services } from "./services.js";
import type { RunningConsumer } from "./shutdown.js";

// `processBatch` takes a real `SQSRecord[]` (the Lambda event shape); the
// long-poll `ReceiveMessageCommand` result carries the same message id/body
// plus SDK-specific fields, so this fills in the rest with inert placeholders
// — `processBatch` only reads `record.body` and `record.messageId`.
const toSqsRecord = (
	sqsMessage: NonNullable<ReceiveMessageCommandOutput["Messages"]>[number],
): SQSRecord =>
	({
		messageId: sqsMessage.MessageId ?? sqsMessage.ReceiptHandle ?? "",
		body: sqsMessage.Body ?? "",
		receiptHandle: sqsMessage.ReceiptHandle ?? "",
		attributes: {} as SQSRecord["attributes"],
		messageAttributes: {},
		md5OfBody: sqsMessage.MD5OfBody ?? "",
		eventSource: "aws:sqs",
		eventSourceARN: "",
		awsRegion: "",
	}) satisfies SQSRecord;

const createSqsClient = (queueUrl: string): SQSClient => {
	const isLocal = queueUrl.startsWith("http://localhost");
	return new SQSClient({
		endpoint: isLocal ? new URL(queueUrl).origin : undefined,
		...(isLocal
			? {
					protocol: AwsQueryProtocol,
					credentials: { accessKeyId: "local", secretAccessKey: "local" },
				}
			: { credentials: resolveSqsCredentials() }),
	});
};

export interface SqsConsumerConfig {
	/** Search-index queue URL; defaults to `SQS_QUEUE_URL_SEARCH_INDEX`. */
	queueUrl?: string;
	services: Services;
	logger: Logger;
}

/**
 * Long-polls the search-index SQS queue and processes one message at a time
 * via `processBatch` (a batch of one) — the same per-message logic the AWS
 * Lambda handler runs, reused so the two deployment shapes (Lambda event
 * source mapping vs. a long-running container/pm2 process) share one
 * indexing implementation. Used by the Postgres-parity stack, where the
 * search-index queue has no Lambda event source; `remit-pg-index-worker`
 * only relays committed outbox events onto this queue (the producer side —
 * see its `worker.ts`), it does not consume them.
 *
 * A message is deleted only when `processBatch` reports no failure for it;
 * a failure leaves it on the queue so its visibility timeout lapses and SQS
 * redelivers (and eventually dead-letters) it — SQS owns the retry, same as
 * the Lambda path's `batchItemFailures`.
 *
 * Every outcome is fed to `IndexWorkStats` (via `Services.onIndexOutcome`)
 * and flushed on a lazy interval — the pg-only "index work summary" signal
 * that surfaces over-triggering (#1082) CloudWatch alarms can't see.
 */
export const startSqsConsumer = (
	config: SqsConsumerConfig,
): RunningConsumer => {
	const { logger: log } = config;
	const queueUrl = config.queueUrl ?? process.env.SQS_QUEUE_URL_SEARCH_INDEX;
	if (!queueUrl) throw new Error("SQS_QUEUE_URL_SEARCH_INDEX is required");

	const sqs = createSqsClient(queueUrl);

	const stats: IndexWorkStats = createIndexWorkStats();
	const flushStats = (): void => {
		const summary = stats.drain();
		if (summary) log.info("index work summary", { ...summary });
	};
	const SUMMARY_INTERVAL_MS = 60_000;
	const summaryTimer = setInterval(flushStats, SUMMARY_INTERVAL_MS);
	summaryTimer.unref();

	const controller = new AbortController();
	const consume = async (): Promise<void> => {
		while (!controller.signal.aborted) {
			let response: ReceiveMessageCommandOutput;
			try {
				response = await sqs.send(
					new ReceiveMessageCommand({
						QueueUrl: queueUrl,
						MaxNumberOfMessages: 10,
						WaitTimeSeconds: 20,
						VisibilityTimeout: 300,
					}),
					{ abortSignal: controller.signal },
				);
			} catch (error) {
				if (controller.signal.aborted) return;
				throw error;
			}

			for (const sqsMessage of response.Messages ?? []) {
				if (!sqsMessage.Body || !sqsMessage.ReceiptHandle) continue;

				const body = sqsMessage.Body;
				const parsed = await Promise.resolve()
					.then(() => parseQueueMessage(body))
					.catch((error: unknown) => {
						log.error("parse failed", { body, error: String(error) });
						return null;
					});
				if (!parsed) continue;
				const force = parsed.kind === "upsert" ? parsed.force : false;

				let lastOutcome: IndexOutcome | undefined;
				const services: Services = {
					...config.services,
					onIndexOutcome: (outcome) => {
						lastOutcome = outcome;
					},
				};

				const { batchItemFailures } = await processBatch(
					[toSqsRecord(sqsMessage)],
					services,
					log,
				);

				if (lastOutcome) stats.record(lastOutcome, force);

				if (batchItemFailures.length === 0) {
					await sqs.send(
						new DeleteMessageCommand({
							QueueUrl: queueUrl,
							ReceiptHandle: sqsMessage.ReceiptHandle,
						}),
					);
				}
			}
		}
	};
	const consumer = consume();

	return {
		stop: async () => {
			clearInterval(summaryTimer);
			flushStats();
			controller.abort();
			await consumer;
			sqs.destroy();
		},
	};
};
