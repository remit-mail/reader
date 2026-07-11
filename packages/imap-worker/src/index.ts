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

/**
 * Parse SQS's `ApproximateReceiveCount` record attribute (1 on first
 * delivery). Missing/malformed defaults to 1 so a record with no attribute
 * (e.g. an older local harness) is treated as a first attempt rather than
 * skipping straight to retry-exhaustion handling.
 */
export const parseReceiveCount = (value: string | undefined): number => {
	const parsed = Number.parseInt(value ?? "1", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

export const handler: SQSHandler = withTelemetry(
	async (event: SQSEvent): Promise<SQSBatchResponse> => {
		const batchItemFailures: { itemIdentifier: string }[] = [];

		for (const record of event.Records) {
			const imapEvent: WorkerEvent = JSON.parse(record.body);
			const receiveCount = parseReceiveCount(
				record.attributes?.ApproximateReceiveCount,
			);
			log.info(
				{
					eventType: imapEvent.type,
					eventId: "eventId" in imapEvent ? imapEvent.eventId : undefined,
					receiveCount,
				},
				"Processing event",
			);

			metrics.addDimension("operation", imapEvent.type);
			const opStart = Date.now();
			const failed = await processEvent(imapEvent, log, receiveCount)
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
