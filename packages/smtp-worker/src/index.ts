import { inspect } from "node:util";
import { createLogger } from "@remit/logger-lambda";
import type {
	Context,
	SQSBatchResponse,
	SQSEvent,
	SQSHandler,
} from "aws-lambda";
import type { SmtpEvent } from "./events.js";
import { processEvent } from "./processor.js";

export const handler: SQSHandler = async (
	event: SQSEvent,
	context: Context,
): Promise<SQSBatchResponse> => {
	const log = createLogger(context);
	const batchItemFailures: { itemIdentifier: string }[] = [];

	for (const record of event.Records) {
		try {
			const smtpEvent: SmtpEvent = JSON.parse(record.body);
			log.info(
				{ eventType: smtpEvent.type, eventId: smtpEvent.eventId },
				"Processing SMTP event",
			);

			await processEvent(smtpEvent, log);
		} catch (error) {
			log.error(
				{ error: inspect(error), messageId: record.messageId },
				"SMTP event processing failed",
			);
			batchItemFailures.push({ itemIdentifier: record.messageId });
		}
	}

	return { batchItemFailures };
};
