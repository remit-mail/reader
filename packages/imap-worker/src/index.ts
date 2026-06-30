import {
	createLogger,
	MetricUnit,
	metrics,
	withTelemetry,
} from "@remit/logger-lambda";
import type { SQSBatchResponse, SQSEvent, SQSHandler } from "aws-lambda";
import type { WorkerEvent } from "./events.js";
import { processEvent } from "./processor.js";

const log = createLogger();

export const handler: SQSHandler = withTelemetry(
	async (event: SQSEvent): Promise<SQSBatchResponse> => {
		const batchItemFailures: { itemIdentifier: string }[] = [];

		for (const record of event.Records) {
			const imapEvent: WorkerEvent = JSON.parse(record.body);
			log.info(
				{
					eventType: imapEvent.type,
					eventId: "eventId" in imapEvent ? imapEvent.eventId : undefined,
				},
				"Processing event",
			);

			metrics.addDimension("operation", imapEvent.type);
			const opStart = Date.now();
			const failed = await processEvent(imapEvent, log)
				.then(() => {
					metrics.addMetric(
						"imapOperationLatency",
						MetricUnit.Milliseconds,
						Date.now() - opStart,
					);
					return false;
				})
				.catch((error) => {
					log.error(
						{ error, messageId: record.messageId },
						"Event processing failed",
					);
					metrics.addMetric("imapOperationFailures", MetricUnit.Count, 1);
					return true;
				});
			metrics.clearDimensions();

			if (failed) {
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	},
);
