import type {
	IMessageRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import { MessageSyncStatus } from "@remit/domain-enums";
import {
	type IImapConnection,
	isMessageGoneFromOpenMailbox,
	reconcileStaleMessage,
	type StaleMessageReconcileDeps,
} from "@remit/mailbox-service";
import { restoreSourcePlacement } from "./restore-source-placement.js";

export interface MessageMoveTerminalLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	error(obj: Record<string, unknown>, msg: string): void;
}

export interface ResolveExhaustedMessageMoveDeps
	extends StaleMessageReconcileDeps {
	messageService: Pick<IMessageRepository, "delete" | "updateForMove">;
	threadMessageService: Pick<
		IThreadMessageRepository,
		"findAllByMessageId" | "deleteMany" | "update"
	>;
	log: MessageMoveTerminalLogger;
}

export interface ResolveExhaustedMessageMoveInput {
	accountId: string;
	accountConfigId: string;
	messageId: string;
	sourceMailboxId: string;
	uid: number;
	sourceMailboxPath: string;
	getConnection: () => Promise<IImapConnection>;
}

export type MessageMoveTerminalOutcome = "reconciled" | "broken";

export interface ResolveExhaustedMessageMoveResult {
	outcome: MessageMoveTerminalOutcome;
}

/**
 * Resolve a MESSAGE_MOVE failure that has exhausted the message queue's
 * redelivery budget into exactly one of two terminal outcomes, mirroring
 * `resolveExhaustedPlacementMoveFailure` and `resolveExhaustedFlagPushFailure`
 * for the same failure taxonomy (issue #655) — no third, softer outcome.
 *
 * The move's pending state is the Message row itself (`status: moving`,
 * `originalMailboxId`/`originalUid`, `mailboxId` already pointing at the
 * destination), not a separate marker, so the outcomes act on that row.
 *
 * 1. RECONCILED (expected) — the message no longer exists at the move's source
 *    on IMAP, confirmed by {@link isMessageGoneFromOpenMailbox} rather than by
 *    a FETCH coming back empty. Either the MOVE did execute server-side and
 *    the connection dropped before the tagged OK was read, or a foreign client
 *    moved or expunged the message; from here those are indistinguishable and
 *    have the same answer. The stale Message/ThreadMessage rows are deleted
 *    via {@link reconcileStaleMessage} and the caller resyncs both folders, so
 *    whichever folder actually holds the message re-projects it with the
 *    server's own UID. Metric only, no alarm — routine.
 * 2. BROKEN — the message is still at the source, so the move never took
 *    effect, but it keeps failing: broken code or a broken account, not a
 *    transient blip. The row is put back where the server has just said the
 *    message is, as `resolveExhaustedMessageDeleteFailure` does (#1098). Logged
 *    with an `alert`-shaped entry for an operator alarm; never re-thrown
 *    (terminal — the caller acks either way, since retrying a
 *    permanently-broken move can never succeed).
 *
 *    Leaving the row `moving` is what this replaces. BROKEN is terminal, so
 *    nothing was ever going to come back and settle it, and only `updateUid`
 *    clears `moving` — the row kept a `mailboxId` naming the destination and a
 *    `uid` belonging to the source, which `bindsForeignUid` refuses to act on,
 *    leaving the message undeletable and unmovable for good (issue #1005).
 *    Restoring the pair is not the revert-on-ambiguity PR #652 was pulled for:
 *    the presence probe above has just answered, so this writes a placement the
 *    server confirmed, and a MOVE that lands after all is re-projected by the
 *    resync the caller runs.
 *
 * A server that cannot be reached at exhaustion time never reaches either
 * verdict: the probe throws and the record dead-letters with the row untouched.
 * Absence is only ever concluded from an answer the server gave.
 *
 * An operator reading `message_move_failed` should know one case where the
 * message is not actually at the source: a message another client expunged
 * mid-session can answer an empty FETCH while the server still lists its UID
 * in SEARCH, until it is allowed to send the untagged EXPUNGE. That message
 * lands in BROKEN, and BROKEN is terminal — the row is bound to a source the
 * message has already left and the alert stands until someone clears it. The
 * reverse mistake discards the row for live mail, so the cost is paid
 * deliberately.
 */
export const resolveExhaustedMessageMoveFailure = async (
	deps: ResolveExhaustedMessageMoveDeps,
	input: ResolveExhaustedMessageMoveInput,
): Promise<ResolveExhaustedMessageMoveResult> => {
	const {
		accountId,
		accountConfigId,
		messageId,
		sourceMailboxId,
		uid,
		sourceMailboxPath,
		getConnection,
	} = input;

	const connection = await getConnection();
	await connection.openBox(sourceMailboxPath, true);

	if (await isMessageGoneFromOpenMailbox(connection, uid)) {
		const { threadMessagesDeleted } = await reconcileStaleMessage(
			deps,
			accountConfigId,
			messageId,
		);
		deps.log.info(
			{
				metric: "message_move_stale_row_reconciled",
				accountId,
				accountConfigId,
				messageId,
				uid,
				sourceMailboxPath,
				threadMessagesDeleted,
			},
			"Message no longer at its move source after retry exhaustion (move landed server-side, or an external delete or move); stale row reconciled",
		);
		return { outcome: "reconciled" };
	}

	deps.log.error(
		{
			alert: "message_move_failed",
			accountId,
			accountConfigId,
			messageId,
			uid,
			sourceMailboxId,
			sourceMailboxPath,
		},
		"Message move could not be pushed to IMAP after retry exhaustion; the message is still at its source — row moved back to the source folder",
	);

	await restoreSourcePlacement(deps, {
		accountConfigId,
		messageId,
		sourceMailboxId,
		uid,
		// The probe above just confirmed the pair, so the row is a faithful
		// projection of the source again. The move's own failure is the alert, not
		// a `failed` left on a row nothing is still trying to move.
		syncStatus: MessageSyncStatus.synced,
	});

	return { outcome: "broken" };
};
