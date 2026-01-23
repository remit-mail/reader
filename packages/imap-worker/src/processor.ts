import type { Logger } from "@remit/remit-logger-lambda";
import type { ImapEvent } from "./events.js";
import { handleEmptyTrash } from "./handlers/empty-trash.js";
import { processMailboxManagement } from "./handlers/mailbox-management.js";
import { handleMessageDelete } from "./handlers/message-delete.js";
import { handleMessageMove } from "./handlers/message-move.js";
import { syncFlags } from "./handlers/sync-flags.js";
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
		case "SYNC_FLAGS":
			return syncFlags(event, log);
		case "MAILBOX_CREATE":
		case "MAILBOX_RENAME":
		case "MAILBOX_DELETE":
			return processMailboxManagement(event, log);
		case "MESSAGE_DELETE":
			return handleMessageDelete(event, log);
		case "MESSAGE_MOVE":
			return handleMessageMove(event, log);
		case "EMPTY_TRASH":
			return handleEmptyTrash(event, log);
		default:
			throw new Error(`Unknown event type: ${(event as ImapEvent).type}`);
	}
};
