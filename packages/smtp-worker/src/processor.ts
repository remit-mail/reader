import type { Logger } from "@remit/logger-lambda";
import type { SmtpEvent } from "./events.js";
import { handleSendMessage } from "./handlers/send-message.js";

export const processEvent = async (
	event: SmtpEvent,
	log: Logger,
	/**
	 * SQS's own delivery count for the record carrying this event (1 on first
	 * delivery). Read by SEND_MESSAGE so it knows from it when this is the
	 * last attempt before the queue's own redrive policy would DLQ the
	 * record, so it can resolve retry exhaustion into a terminal outcome
	 * (issue #951) instead of dead-lettering blindly.
	 */
	receiveCount = 1,
): Promise<void> => {
	switch (event.type) {
		case "SEND_MESSAGE":
			return handleSendMessage(event, log, receiveCount);
		case "PROCESS_OUTBOX":
			// Future: batch process all queued messages
			log.info(
				{ accountId: event.accountId },
				"PROCESS_OUTBOX not yet implemented",
			);
			return;
		default:
			throw new Error(`Unknown event type: ${(event as SmtpEvent).type}`);
	}
};
