import { createLogger } from "@remit/logger-lambda";
import type {
	Context,
	SQSBatchResponse,
	SQSEvent,
	SQSHandler,
} from "aws-lambda";
import type { WorkerEvent } from "./events.js";
import { processEvent } from "./processor.js";

export const handler: SQSHandler = async (
	event: SQSEvent,
	context: Context,
): Promise<SQSBatchResponse> => {
	const log = createLogger(context);
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

			await processEvent(imapEvent, log);
		} catch (error) {
			log.error(
				{ error, messageId: record.messageId },
				"Event processing failed",
			);
			batchItemFailures.push({ itemIdentifier: record.messageId });
		}
	}

	return { batchItemFailures };
};
