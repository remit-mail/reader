import {
	type IImapConnection,
	isMessageGoneFromOpenMailbox,
	reconcileStaleMessage,
	type StaleMessageReconcileDeps,
} from "@remit/mailbox-service";

export interface MessageMoveTerminalLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	error(obj: Record<string, unknown>, msg: string): void;
}

export interface ResolveExhaustedMessageMoveDeps
	extends StaleMessageReconcileDeps {
	log: MessageMoveTerminalLogger;
}

export interface ResolveExhaustedMessageMoveInput {
	accountId: string;
	accountConfigId: string;
	messageId: string;
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
 *    transient blip. Local state is left exactly as it stands. Reverting the
 *    optimistic move here is what PR #652 was pulled for: the local row is the
 *    only record that this move is still owed, and a revert races a MOVE that
 *    may yet have landed. Logged with an `alert`-shaped entry for an operator
 *    alarm; never re-thrown (terminal — the caller acks either way, since
 *    retrying a permanently-broken move can never succeed).
 *
 * A server that cannot be reached at exhaustion time never reaches either
 * verdict: the probe throws and the record dead-letters with the row untouched.
 * Absence is only ever concluded from an answer the server gave.
 *
 * An operator reading `message_move_failed` should know one case where the
 * message is not actually at the source: a message another client expunged
 * mid-session can answer an empty FETCH while the server still lists its UID
 * in SEARCH, until it is allowed to send the untagged EXPUNGE. That message
 * lands in BROKEN, and BROKEN is terminal — the row stays pending and the
 * alert stands until someone clears it. The reverse mistake discards the row
 * for live mail, so the cost is paid deliberately.
 */
export const resolveExhaustedMessageMoveFailure = async (
	deps: ResolveExhaustedMessageMoveDeps,
	input: ResolveExhaustedMessageMoveInput,
): Promise<ResolveExhaustedMessageMoveResult> => {
	const {
		accountId,
		accountConfigId,
		messageId,
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
			sourceMailboxPath,
		},
		"Message move could not be pushed to IMAP after retry exhaustion; message still exists at its source — local state left pending for operator investigation",
	);
	return { outcome: "broken" };
};
