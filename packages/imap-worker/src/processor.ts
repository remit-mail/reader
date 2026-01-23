import type { Logger } from "@remit/remit-logger-lambda";
import type { ImapEvent } from "./events.js";
import { fetchBody } from "./handlers/fetch-body.js";
import { syncMailboxes } from "./handlers/sync-mailboxes.js";
import { syncMessages } from "./handlers/sync-messages.js";
import { updateFlags } from "./handlers/update-flags.js";

export const processEvent = async (
	event: ImapEvent,
	log: Logger,
): Promise<void> => {
	switch (event.type) {
		case "SYNC_MAILBOXES":
			return syncMailboxes(event, log);
		case "SYNC_MESSAGES":
			return syncMessages(event, log);
		case "FETCH_BODY":
			return fetchBody(event, log);
		case "UPDATE_FLAGS":
			return updateFlags(event, log);
		default:
			throw new Error(`Unknown event type: ${(event as ImapEvent).type}`);
	}
};
