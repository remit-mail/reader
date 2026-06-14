import { inspect } from "node:util";
import { createLogger, withTelemetry } from "@remit/logger-lambda";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { SmtpEvent } from "./events.js";
import { processEvent } from "./processor.js";

const log = createLogger();

export const handler = withTelemetry(
	async (event: SQSEvent): Promise<SQSBatchResponse> => {
		const batchItemFailures: { itemIdentifier: string }[] = [];

		for (const record of event.Records) {
			try {
				const smtpEvent: SmtpEvent = JSON.parse(record.body);
				log.info("Processing SMTP event", {
					eventType: smtpEvent.type,
					eventId: smtpEvent.eventId,
				});

				await processEvent(smtpEvent, log);
			} catch (error) {
				log.error("SMTP event processing failed", {
					error: inspect(error),
					messageId: record.messageId,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	},
);
