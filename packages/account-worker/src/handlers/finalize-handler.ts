import { inspect } from "node:util";
import { createLogger } from "@remit/logger-lambda";
import type {
	Context,
	SQSBatchResponse,
	SQSEvent,
	SQSHandler,
} from "aws-lambda";
import type { AccountFinalizeEvent } from "../events.js";
import { processAccountFinalize } from "./account-finalize.js";

export const finalizeHandler: SQSHandler = async (
	event: SQSEvent,
	context: Context,
): Promise<SQSBatchResponse> => {
	const log = createLogger(context);
	const batchItemFailures: { itemIdentifier: string }[] = [];

	for (const record of event.Records) {
		try {
			const finalizeEvent: AccountFinalizeEvent = JSON.parse(record.body);
			log.info(
				{
					eventType: finalizeEvent.type,
					accountConfigId: finalizeEvent.accountConfigId,
				},
				"Processing account finalize event",
			);

			await processAccountFinalize(finalizeEvent, log);
		} catch (error) {
			log.error(
				{ error: inspect(error), messageId: record.messageId },
				"Account finalize event processing failed",
			);
			batchItemFailures.push({ itemIdentifier: record.messageId });
		}
	}

	return { batchItemFailures };
};
