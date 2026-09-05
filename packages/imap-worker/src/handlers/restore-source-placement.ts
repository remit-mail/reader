import type {
	IMessageRepository,
	IThreadMessageRepository,
	MessageItem,
} from "@remit/data-ports";
import { MessageStatus } from "@remit/domain-enums";
import { isNotFoundError } from "../is-not-found.js";
import { buildThreadMessageMoveRevert } from "./thread-message-rows.js";

export interface RestoreSourcePlacementDeps {
	messageService: Pick<IMessageRepository, "updateForMove">;
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
	/**
	 * What the row records about the mutation that will now never happen.
	 * `synced` where the row is a faithful projection of the source again — the
	 * server never received the command, or has just said the message is still
	 * there. `failed` where the product refused an operation the user asked for,
	 * which is a failure the row has to carry.
	 */
	syncStatus: MessageItem["syncStatus"];
}

/**
 * Put a row back on the pre-mutation source pair and hand its listing rows back
 * with it.
 *
 * `status: moving` has to be cleared here or the row is stuck: a give-up that
 * writes `syncStatus: failed` and returns leaves the row naming the destination
 * with the source's uid — the pair `bindsForeignUid` calls a lie and
 * `MessagePlacementUnsettledError` refuses to act on. Nothing routine repairs it
 * (sync does not touch `status`, and the cursor rebuild's `updateUid` runs only
 * on a UIDVALIDITY change), so the message is undeletable and unmovable for good
 * (issue #1005).
 *
 * `updateForMove`, not `updateUid`: both write the same settled pair, but
 * `updateUid` also appends a `message.moved` outbox row so the search index can
 * refresh the mailbox it stores per message. Nothing here moved. The optimistic
 * `updateForMove` that pointed the row at the destination never enqueued one
 * either, so the index still holds the source and a revert has nothing to
 * correct — the re-index would be a forced pass over an unchanged document.
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
 * A paused-cursor caller reaches here from a `MailboxCursorPausedError` the
 * openBox guard threw before the outbound command was issued (issue #1203), and
 * restores the pre-mutation pair off its own event. On a FIRST delivery that is
 * not an inference but an undo: the command provably never left, so the row is
 * put back exactly as it was found. A redelivery cannot claim that — the
 * earlier attempt's tagged OK can be lost with the connection — so it asks
 * `probePausedPlacement` which folder holds the message and only reaches here
 * once the answer rules the destination out. Either way the source mailbox is
 * by definition awaiting a cursor rebuild, which matches its rows by Message-ID
 * and adjudicates the uid: handing the row back is what puts it in the set the
 * rebuild walks, since a row still naming the destination is in neither
 * folder's.
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
	const { accountConfigId, messageId, sourceMailboxId, uid, syncStatus } =
		input;

	const skipNotFound = (error: unknown): void => {
		if (isNotFoundError(error)) return;
		throw error;
	};

	const messageRestored = await deps.messageService
		.updateForMove(messageId, {
			mailboxId: sourceMailboxId,
			uid,
			status: MessageStatus.active,
			syncStatus,
		})
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
