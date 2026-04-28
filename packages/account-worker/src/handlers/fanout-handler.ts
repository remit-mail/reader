import { inspect } from "node:util";
import { createLogger } from "@remit/logger-lambda";
import type {
	Context,
	SQSBatchResponse,
	SQSEvent,
	SQSHandler,
} from "aws-lambda";
import type { AccountFanoutEvent } from "../events.js";
import { processAccountFanout } from "./account-fanout.js";

export const fanoutHandler: SQSHandler = async (
	event: SQSEvent,
	context: Context,
): Promise<SQSBatchResponse> => {
	const log = createLogger(context);
	const batchItemFailures: { itemIdentifier: string }[] = [];

	for (const record of event.Records) {
		try {
			const fanoutEvent: AccountFanoutEvent = JSON.parse(record.body);
			log.info(
				{
					eventType: fanoutEvent.type,
					accountConfigId: fanoutEvent.accountConfigId,
				},
				"Processing account fanout event",
			);

			await processAccountFanout(fanoutEvent, log);
		} catch (error) {
			log.error(
				{ error: inspect(error), messageId: record.messageId },
				"Account fanout event processing failed",
			);
			batchItemFailures.push({ itemIdentifier: record.messageId });
		}
	}

	return { batchItemFailures };
};
