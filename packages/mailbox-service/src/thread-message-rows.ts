import type { ThreadMessageItem } from "@remit/data-ports";

/**
 * Build the `set` and `composites` payload for the ThreadMessage update on a
 * MESSAGE_DELETE move-to-trash.
 *
 * The CURRENT row state goes in `composites`; the NEW values go in `set`.
 * ElectroDB uses `composites` to run the conditional check on the existing row
 * AND to compute the previous sort-key values needed to recompute the new ones.
 * Passing the NEW values in `composites` makes the conditional check fail with
 * ConditionalCheckFailedException, which ElectroDB wraps as NotFoundError, and
 * the caller silently drops the update. Same root cause as PR #186 fixed for
 * `flag-queue.ts`.
 */
export type ThreadMessageRowState = Pick<
	ThreadMessageItem,
	| "sentDate"
	| "mailboxId"
	| "isRead"
	| "isDeleted"
	| "hasStars"
	| "hasAttachment"
>;

const currentComposites = (threadMessage: ThreadMessageRowState) => ({
	sentDate: threadMessage.sentDate,
	mailboxId: threadMessage.mailboxId,
	isRead: threadMessage.isRead,
	isDeleted: threadMessage.isDeleted,
	hasStars: threadMessage.hasStars,
	hasAttachment: threadMessage.hasAttachment,
});

export const buildThreadMessageTrashUpdate = (
	threadMessage: ThreadMessageRowState,
	newUid: number,
	destinationMailboxId: string,
) => ({
	set: {
		uid: newUid,
		mailboxId: destinationMailboxId,
		isDeleted: true,
	},
	composites: currentComposites(threadMessage),
});

/**
 * The inverse payload: put the thread row back where the message still is on
 * the server. The delete was recorded optimistically, so a delete that gives up
 * with the message still at its source has to hand the row back rather than
 * leave it claiming Trash — an invisible `failed` on a row the user cannot see
 * is the shape of the incident this whole change is about.
 */
export const buildThreadMessageMoveRevert = (
	threadMessage: ThreadMessageRowState,
	sourceUid: number,
	sourceMailboxId: string,
) => ({
	set: {
		uid: sourceUid,
		mailboxId: sourceMailboxId,
		isDeleted: false,
	},
	composites: currentComposites(threadMessage),
});

/**
 * Hand a row back after an abandoned expunge. The mail never left Trash, so
 * only the deletion mark reverts — the uid and mailbox on the row are still
 * where the server has it.
 */
export const buildThreadMessageUndelete = (
	threadMessage: ThreadMessageRowState,
) => ({
	set: { isDeleted: false },
	composites: currentComposites(threadMessage),
});
