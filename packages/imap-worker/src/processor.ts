import type { Logger } from "@remit/logger-lambda";
import type { ImapEvent } from "./events.js";
import { syncMailboxes } from "./handlers/sync-mailboxes.js";
import { syncMessageBody } from "./handlers/sync-message-body.js";
import { syncMessages } from "./handlers/sync-messages.js";

export const processEvent = async (
	event: ImapEvent,
	log: Logger,
): Promise<void> => {
	switch (event.type) {
		case "SYNC_MAILBOXES":
			return syncMailboxes(event, log);
		case "SYNC_MESSAGES":
			return syncMessages(event, log);
		case "SYNC_MESSAGE_BODY":
			return syncMessageBody(event, log);
		default:
			throw new Error(`Unknown event type: ${(event as ImapEvent).type}`);
	}
};
