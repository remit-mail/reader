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

export const handler = withTelemetry(
	async (event: SQSEvent): Promise<SQSBatchResponse> => {
		const batchItemFailures: { itemIdentifier: string }[] = [];

		for (const record of event.Records) {
			const smtpEvent: SmtpEvent = JSON.parse(record.body);
			log.info("Processing SMTP event", {
				eventType: smtpEvent.type,
				eventId: smtpEvent.eventId,
			});

			const queue = queueNameFromEventSource(record.eventSourceARN);
			const sendStart = Date.now();
			const failed = await processEvent(smtpEvent, log)
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
