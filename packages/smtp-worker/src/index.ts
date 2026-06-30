import { inspect } from "node:util";
import {
	createLogger,
	MetricUnit,
	metrics,
	withTelemetry,
} from "@remit/logger-lambda";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { SmtpEvent } from "./events.js";
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

			const sendStart = Date.now();
			const failed = await processEvent(smtpEvent, log)
				.then(() => {
					metrics.addMetric(
						"smtpSendLatency",
						MetricUnit.Milliseconds,
						Date.now() - sendStart,
					);
					return false;
				})
				.catch((error) => {
					log.error("SMTP event processing failed", {
						error: inspect(error),
						messageId: record.messageId,
					});
					metrics.addMetric("smtpSendFailures", MetricUnit.Count, 1);
					return true;
				});

			if (failed) {
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	},
);
