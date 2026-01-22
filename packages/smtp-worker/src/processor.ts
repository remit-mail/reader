import type { Logger } from "@remit/logger-lambda";
import type { SmtpEvent } from "./events.js";
import { handleSendMessage } from "./handlers/send-message.js";

export const processEvent = async (
	event: SmtpEvent,
	log: Logger,
): Promise<void> => {
	switch (event.type) {
		case "SEND_MESSAGE":
			return handleSendMessage(event, log);
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
