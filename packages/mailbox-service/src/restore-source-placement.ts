import type {
	IMessageRepository,
	IThreadMessageRepository,
	MessageItem,
	ThreadMessageItem,
} from "@remit/data-ports";
import { isNotFoundError } from "@remit/data-ports/errors";
import { MessageStatus } from "@remit/domain-enums";
import { buildThreadMessageMoveRevert } from "./thread-message-rows.js";

export interface RestoreSourcePlacementDeps {
	messageService: Pick<IMessageRepository, "transitionPlacement">;
	threadMessageService: Pick<
		IThreadMessageRepository,
		"findAllByMessageId" | "update"
	>;
}

/** Whether the row was still owed a restore when this ran. */
export type RestoreSourcePlacementOutcome = "restored" | "superseded";

export interface RestoreSourcePlacementInput {
	accountConfigId: string;
	messageId: string;
	sourceMailboxId: string;
	uid: number;
	/**
	 * What the row records about the mutation that will now never happen.
	 * `synced` where the row is a faithful projection of the source again and
	 * nothing was refused. `abandoned` where a mutation the user asked for gave
	 * up, which is a failure the row has to carry (imap-mutations R3).
	 */
	syncStatus: MessageItem["syncStatus"];
	/**
	 * Which mutation gave up, for the row to carry alongside `abandoned`. The
	 * hand-back is about to set `status` back to `active`, and `status` was the
	 * only field naming it — without this the client can see that something was
	 * abandoned and not what, which is how a move that handed back was reported
	 * as a failed delete (issue #1229). `none` accompanies every other
	 * `syncStatus`, so the field never outlives its gate.
	 */
	abandonedMutation: MessageItem["abandonedMutation"];
	/**
	 * The listing rows, where the caller has already read them to pick this
	 * outcome. Omitted, they are read here.
	 */
	threadMessages?: ThreadMessageItem[];
}

/**
 * Put a row back on the pre-mutation source pair and hand its listing rows back
 * with it.
 *
 * `status: moving` has to be cleared here or the row is stuck: a give-up that
 * writes a sync status and returns leaves the row naming the destination with
 * the source's uid — the pair `placementBindingOf` calls a lie and
 * `MessagePlacementUnsettledError` refuses to act on. Nothing routine repairs it
 * (sync does not touch `status`, and the cursor rebuild's `updateUid` runs only
 * on a UIDVALIDITY change), so the message is undeletable and unmovable for good
 * (issue #1005).
 *
 * A transition, not a plain update (imap-mutations R3): the restore is only
 * owed while a mutation is still outstanding on the row, so the predicate is
 * `moving` or `deleting`. A row another lane has already settled — the
 * placement-move push runs off a standard queue and is ordered against nothing
 * on the account's FIFO — is the winner, and dragging it back to a source it
 * has since left is the corruption this predicate exists to refuse. The loser
 * writes nothing at all, listing rows included, and answers `superseded`.
 *
 * No `message.moved` outbox row: nothing here moved. The optimistic write that
 * pointed the row at the destination never enqueued one either, so the search
 * index still holds the source and a revert has nothing to correct.
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
 * restore, and it fails the predicate like any other row that is no longer
 * owed one. A listing row that other path has already rewritten is its to
 * finish; the update for it comes back `NotFoundError`, and that is a settled
 * state here rather than a fault. Throwing on it would escape the caller's
 * `.catch()` and cost the record its ack and its resync, which is the contract
 * the terminal resolvers state: never re-thrown.
 */
export const restoreSourcePlacement = async (
	deps: RestoreSourcePlacementDeps,
	input: RestoreSourcePlacementInput,
): Promise<RestoreSourcePlacementOutcome> => {
	const {
		accountConfigId,
		messageId,
		sourceMailboxId,
		uid,
		syncStatus,
		abandonedMutation,
	} = input;

	const skipNotFound = (error: unknown): void => {
		if (isNotFoundError(error)) return;
		throw error;
	};

	const restored = await deps.messageService.transitionPlacement(
		messageId,
		{ status: [MessageStatus.moving, MessageStatus.deleting] },
		{
			mailboxId: sourceMailboxId,
			uid,
			status: MessageStatus.active,
			syncStatus,
			abandonedMutation,
		},
	);
	if (!restored) return "superseded";

	const threadMessages =
		input.threadMessages ??
		(await deps.threadMessageService.findAllByMessageId(
			accountConfigId,
			messageId,
		));
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
	return "restored";
};
