import type { ProcessContext } from "./context.js";
import type { WorkerEvent } from "./events.js";
import { handleAppendSentMessage } from "./handlers/append-sent-message.js";
import { handleDeleteAccountObjects } from "./handlers/delete-account-objects.js";
import { handleEmptyTrash } from "./handlers/empty-trash.js";
import { handleFlagPush } from "./handlers/flag-push.js";
import { processMailboxManagement } from "./handlers/mailbox-management.js";
import { handleMessageCopy } from "./handlers/message-copy.js";
import { handleMessageDelete } from "./handlers/message-delete.js";
import { handleMessageMove } from "./handlers/message-move.js";
import { handlePlacementMovePush } from "./handlers/placement-move-push.js";
import { syncMailboxes } from "./handlers/sync-mailboxes.js";
import { syncMessageBody } from "./handlers/sync-message-body.js";
import { syncMessages } from "./handlers/sync-messages.js";
import { withMessageObjectCleanup } from "./message-objects.js";

const dispatch = async (
	event: WorkerEvent,
	ctx: ProcessContext,
	receiveCount: number,
): Promise<void> => {
	switch (event.type) {
		case "SYNC_MAILBOXES":
			return syncMailboxes(event, ctx);
		case "SYNC_MESSAGES":
			return syncMessages(event, ctx);
		case "SYNC_MESSAGE_BODY":
			return syncMessageBody(event, ctx, receiveCount);
		case "MAILBOX_CREATE":
		case "MAILBOX_RENAME":
		case "MAILBOX_DELETE":
			return processMailboxManagement(event, ctx);
		case "MESSAGE_DELETE":
			return handleMessageDelete(event, ctx, receiveCount);
		case "MESSAGE_MOVE":
			return handleMessageMove(event, ctx, receiveCount);
		case "PLACEMENT_MOVE_PUSH":
			return handlePlacementMovePush(event, ctx, receiveCount);
		case "FLAG_PUSH":
			return handleFlagPush(event, ctx, receiveCount);
		case "MESSAGE_COPY":
			return handleMessageCopy(event, ctx, receiveCount);
		case "EMPTY_TRASH":
			return handleEmptyTrash(event, ctx);
		case "APPEND_SENT_MESSAGE":
			return handleAppendSentMessage(event, ctx, receiveCount);
		case "DELETE_ACCOUNT_OBJECTS":
			return handleDeleteAccountObjects(event, ctx);
		default:
			throw new Error(`Unknown event type: ${(event as WorkerEvent).type}`);
	}
};

export const processEvent = (
	event: WorkerEvent,
	ctx: ProcessContext,
	receiveCount: number,
): Promise<void> =>
	dispatch(event, withMessageObjectCleanup(ctx), receiveCount);
