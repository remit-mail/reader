import type {
	IMessageRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import { buildThreadMessageMoveRevert } from "./thread-message-rows.js";

export interface RestoreSourcePlacementDeps {
	messageService: Pick<IMessageRepository, "updateUid">;
	threadMessageService: Pick<
		IThreadMessageRepository,
		"findAllByMessageId" | "update"
	>;
}

export interface RestoreSourcePlacementInput {
	accountConfigId: string;
	messageId: string;
	sourceMailboxId: string;
	uid: number;
}

/**
 * Put a row back on the source pair a presence probe has just confirmed, and
 * hand its listing rows back with it.
 *
 * Only `updateUid` clears `status: moving`, so a give-up that writes
 * `syncStatus: failed` and returns leaves the row naming the destination with
 * the source's uid — the pair `bindsForeignUid` calls a lie and
 * `MessagePlacementUnsettledError` refuses to act on. Nothing routine repairs
 * it (sync does not touch `status`, and the cursor rebuild's `updateUid` runs
 * only on a UIDVALIDITY change), so the message is undeletable and unmovable
 * for good (issue #1005).
 *
 * The caller must have evidence, not an inference: this writes a placement, and
 * a placement written on a guess binds live mail to a uid that names somebody
 * else's message. Every caller reaches here from
 * {@link isMessageGoneFromOpenMailbox} answering that the message is STILL at
 * `sourceMailboxId`/`uid`, which makes this the server's own answer rather than
 * a revert on ambiguity (what PR #652 was pulled for).
 */
export const restoreSourcePlacement = async (
	deps: RestoreSourcePlacementDeps,
	input: RestoreSourcePlacementInput,
): Promise<void> => {
	const { accountConfigId, messageId, sourceMailboxId, uid } = input;

	await deps.messageService.updateUid(messageId, uid, sourceMailboxId);

	const threadMessages = await deps.threadMessageService.findAllByMessageId(
		accountConfigId,
		messageId,
	);
	for (const threadMessage of threadMessages) {
		const args = buildThreadMessageMoveRevert(
			threadMessage,
			uid,
			sourceMailboxId,
		);
		await deps.threadMessageService.update(
			threadMessage.accountConfigId,
			threadMessage.threadMessageId,
			args.set,
			{ composites: args.composites },
		);
	}
};
