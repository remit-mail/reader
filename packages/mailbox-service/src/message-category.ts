import type {
	IThreadMessageRepository,
	ThreadMessageItem,
} from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";

export type MessageCategoryValue = ThreadMessageItem["category"];

export interface MessageCategoryDenormalizeDeps {
	threadMessageService: Pick<
		IThreadMessageRepository,
		"findAllByMessageId" | "update"
	>;
}

export interface MessageCategoryDenormalizeInput {
	category: MessageCategoryValue;
	snippet?: string;
	listId?: string;
}

/**
 * A row is skipped only when every field the denormalization would write
 * already matches. `snippet` and `listId` are absent from the update when the
 * message has neither, and an absent field is not a mismatch.
 */
const alreadyDenormalized = (
	row: ThreadMessageItem,
	update: MessageCategoryDenormalizeInput,
): boolean =>
	row.category === update.category &&
	(update.snippet === undefined || row.snippet === update.snippet) &&
	(update.listId === undefined || row.listId === update.listId);

/**
 * Write a message's category (and, when the caller has them, its snippet and
 * `List-Id`) onto every ThreadMessage row that indexes it. The thread row is
 * what the message list renders and what the category filter matches, so it
 * must never disagree with the Message row it mirrors.
 *
 * More than one row per messageId is schema-legal but not normally produced,
 * and this iterates for the same reason `message-move.ts` does (see the model
 * stated at its `deleteThreadMessagesForMessage`): the key permits it and
 * nothing enforces otherwise. It is NOT the second mailbox a message appears
 * in — `deriveMessageId` and `deriveThreadMessageId` are both
 * mailbox-independent, so INBOX and Archive resolve to one row, and a copy
 * gets its own messageId. The reachable case is thread-root drift: the same
 * message re-saved under different `References`, which mints a second
 * threadId and so a second row. Iterating is therefore hardening against a
 * legal state, not a repair for one the sync path manufactures, which is why
 * the tree's other single-row `messageId` lookups are correct as they stand.
 * `flag-queue.ts` iterates the same list.
 *
 * Rows are looked up by messageId, so this does not depend on the RFC822
 * Message-ID header — a headerless message still gets denormalized, matching
 * the unconditional Message.category write. The composite set is built per
 * row, never reused: `mailboxId` and `isRead` can differ between two rows for
 * one message, and it is passed at all so that a future key-attribute
 * addition touching the lsi3/lsi4/lsi5/gsi2 sort keys keeps the index rows
 * consistent.
 */
export const denormalizeMessageCategory = async (
	deps: MessageCategoryDenormalizeDeps,
	accountConfigId: string,
	messageId: string,
	update: MessageCategoryDenormalizeInput,
): Promise<void> => {
	const rows = await deps.threadMessageService.findAllByMessageId(
		accountConfigId,
		messageId,
	);
	if (rows.length === 0) {
		throw new NotFoundError(`ThreadMessage not found for message ${messageId}`);
	}

	const written = {
		category: update.category,
		...(update.snippet ? { snippet: update.snippet } : {}),
		...(update.listId ? { listId: update.listId } : {}),
	};

	for (const row of rows) {
		if (alreadyDenormalized(row, written)) continue;
		await deps.threadMessageService.update(
			accountConfigId,
			row.threadMessageId,
			written,
			{
				composites: {
					sentDate: row.sentDate,
					mailboxId: row.mailboxId,
					isRead: row.isRead,
					isDeleted: row.isDeleted,
					hasStars: row.hasStars,
					hasAttachment: row.hasAttachment,
				},
			},
		);
	}
};
