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
			try {
				const imapEvent: WorkerEvent = JSON.parse(record.body);
				log.info(
					{
						eventType: imapEvent.type,
						eventId: "eventId" in imapEvent ? imapEvent.eventId : undefined,
					},
					"Processing event",
				);

				const opStart = Date.now();
				await processEvent(imapEvent, log);
				const opDuration = Date.now() - opStart;

				metrics.addDimension("operation", imapEvent.type);
				metrics.addMetric(
					"imapOperationLatency",
					MetricUnit.Milliseconds,
					opDuration,
				);
				metrics.clearDimensions();
			} catch (error) {
				// biome-ignore lint/plugin/no-silent-catch: SQS batch handler — nacking via batchItemFailures is the correct error propagation; rethrowing would crash the entire batch
				const imapEvent = (() => {
					try {
						return JSON.parse(record.body) as WorkerEvent;
					} catch {
						return null;
					}
				})();
				log.error(
					{ error: error, messageId: record.messageId },
					"Event processing failed",
				);
				if (imapEvent) {
					metrics.addDimension("operation", imapEvent.type);
				}
				metrics.addMetric("imapOperationFailures", MetricUnit.Count, 1);
				metrics.clearDimensions();
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	},
);
