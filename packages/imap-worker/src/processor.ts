import type { Logger } from "@remit/remit-logger-lambda";
import type { WorkerEvent } from "./events.js";
import { handleAppendSentMessage } from "./handlers/append-sent-message.js";
import { handleDeleteAccountObjects } from "./handlers/delete-account-objects.js";
import { handleEmptyTrash } from "./handlers/empty-trash.js";
import { processMailboxManagement } from "./handlers/mailbox-management.js";
import { handleMessageCopy } from "./handlers/message-copy.js";
import { handleMessageDelete } from "./handlers/message-delete.js";
import { handleMessageMove } from "./handlers/message-move.js";
import { syncFlags } from "./handlers/sync-flags.js";
import { syncMailboxes } from "./handlers/sync-mailboxes.js";
import { syncMessageBody } from "./handlers/sync-message-body.js";
import { syncMessages } from "./handlers/sync-messages.js";

export const processEvent = async (
	event: WorkerEvent,
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
		case "MESSAGE_COPY":
			return handleMessageCopy(event, log);
		case "EMPTY_TRASH":
			return handleEmptyTrash(event, log);
		case "APPEND_SENT_MESSAGE":
			return handleAppendSentMessage(event, log);
		case "DELETE_ACCOUNT_OBJECTS":
			return handleDeleteAccountObjects(event, log);
		case "IMAP_WORKER_STOP":
			// Tombstone fence on the account row already stops processing;
			// this event acks the cascade contract and is a no-op today.
			log.info(
				{ accountConfigId: event.accountConfigId, accountId: event.accountId },
				"Imap worker stop signal received",
			);
			return;
		default:
			throw new Error(`Unknown event type: ${(event as WorkerEvent).type}`);
	}
};
