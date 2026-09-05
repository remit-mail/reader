import type {
	IMessageRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import { isNotFoundError } from "../is-not-found.js";
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
 * else's message. Two kinds of caller qualify, and nothing else does.
 *
 * A terminal resolver reaches here from {@link isMessageGoneFromOpenMailbox}
 * answering that the message is STILL at `sourceMailboxId`/`uid`, which makes
 * this the server's own answer rather than a revert on ambiguity (what PR #652
 * was pulled for).
 *
 * A paused-cursor caller runs no probe at all and does not need one (issue
 * #1203). It reaches here from a `MailboxCursorPausedError` the openBox guard
 * threw before the outbound command was issued, and the pair it restores is the
 * pre-mutation pair off its own event, never a probe's answer. The source
 * mailbox is by definition awaiting a cursor rebuild, and the rebuild matches
 * its rows by Message-ID: it re-keys this one onto the new axis or reconciles
 * it away. Handing the row back is what puts it in the set the rebuild walks —
 * a row still naming the destination is in neither folder's.
 *
 * A row another path deleted while the probe was in flight has nothing left to
 * restore, and a thread row whose composites have moved on is being rewritten
 * by that other path anyway. Both surface as `NotFoundError` — ElectroDB wraps
 * the conditional-check miss as one — and both are settled states here, not
 * faults. Throwing on them would escape the caller's `.catch()` and cost the
 * record its ack and its resync, which is the contract the terminal resolvers
 * state: never re-thrown.
 */
export const restoreSourcePlacement = async (
	deps: RestoreSourcePlacementDeps,
	input: RestoreSourcePlacementInput,
): Promise<void> => {
	const { accountConfigId, messageId, sourceMailboxId, uid } = input;

	const skipNotFound = (error: unknown): void => {
		if (isNotFoundError(error)) return;
		throw error;
	};

	const messageRestored = await deps.messageService
		.updateUid(messageId, uid, sourceMailboxId)
		.then(() => true)
		.catch((error: unknown) => {
			skipNotFound(error);
			return false;
		});
	if (!messageRestored) return;

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
		await deps.threadMessageService
			.update(
				threadMessage.accountConfigId,
				threadMessage.threadMessageId,
				args.set,
				{ composites: args.composites },
			)
			.catch(skipNotFound);
	}
};
