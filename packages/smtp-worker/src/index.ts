import { inspect } from "node:util";
import {
	createLogger,
	queueNameFromEventSource,
	recordQueueEvent,
	recordSmtpFailure,
	withTelemetry,
} from "@remit/logger-lambda";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { SmtpEvent } from "./events.js";
import { smtpFailureKind } from "./failure-kind.js";
import { processEvent } from "./processor.js";

const log = createLogger();

/**
 * Parse SQS's `ApproximateReceiveCount` record attribute (1 on first
 * delivery). Missing/malformed defaults to 1 so a record with no attribute
 * (e.g. an older local harness) is treated as a first attempt rather than
 * skipping straight to retry-exhaustion handling. Mirrors
 * `imap-worker/src/index.ts`'s `parseReceiveCount`.
 */
export const parseReceiveCount = (value: string | undefined): number => {
	const parsed = Number.parseInt(value ?? "1", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

export const handler = withTelemetry(
	async (event: SQSEvent): Promise<SQSBatchResponse> => {
		const batchItemFailures: { itemIdentifier: string }[] = [];

		for (const record of event.Records) {
			const smtpEvent: SmtpEvent = JSON.parse(record.body);
			const receiveCount = parseReceiveCount(
				record.attributes?.ApproximateReceiveCount,
			);
			log.info("Processing SMTP event", {
				eventType: smtpEvent.type,
				eventId: smtpEvent.eventId,
				receiveCount,
			});

			const queue = queueNameFromEventSource(record.eventSourceARN);
			const sendStart = Date.now();
			const failed = await processEvent(smtpEvent, log, receiveCount)
				.then(() => {
					recordQueueEvent({
						queue,
						eventType: smtpEvent.type,
						outcome: "success",
						durationMs: Date.now() - sendStart,
					});
					return false;
				})
				.catch((error) => {
					log.error("SMTP event processing failed", {
						error: inspect(error),
						messageId: record.messageId,
					});
					recordQueueEvent({
						queue,
						eventType: smtpEvent.type,
						outcome: "failure",
						durationMs: Date.now() - sendStart,
					});
					recordSmtpFailure(smtpFailureKind(error));
					return true;
				});

			if (failed) {
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	},
);
