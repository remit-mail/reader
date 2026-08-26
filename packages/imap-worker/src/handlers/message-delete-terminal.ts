import {
	type IImapConnection,
	isMessageGoneFromOpenMailbox,
	reconcileStaleMessage,
	type StaleMessageReconcileDeps,
} from "@remit/mailbox-service";

export interface MessageDeleteTerminalLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	error(obj: Record<string, unknown>, msg: string): void;
}

export interface ResolveExhaustedMessageDeleteDeps
	extends StaleMessageReconcileDeps {
	log: MessageDeleteTerminalLogger;
}

export interface ResolveExhaustedMessageDeleteInput {
	accountId: string;
	accountConfigId: string;
	messageId: string;
	uid: number;
	sourceMailboxPath: string;
	getConnection: () => Promise<IImapConnection>;
}

export type MessageDeleteTerminalOutcome = "reconciled" | "broken";

export interface ResolveExhaustedMessageDeleteResult {
	outcome: MessageDeleteTerminalOutcome;
}

/**
 * Resolve a MESSAGE_DELETE failure that has exhausted the message-management
 * queue's redelivery budget into exactly one of two terminal outcomes,
 * mirroring `resolveExhaustedMessageMoveFailure` for the same failure taxonomy
 * (issues #655, #980) — no third, softer outcome.
 *
 * The delete's pending state is the Message row itself: a move to Trash has
 * already rewritten `mailboxId` to the destination while `uid` still names the
 * SOURCE folder's uid, and `updateForMove` kept `originalMailboxId` /
 * `originalUid` alongside it. The uid this resolver asks about is that source
 * uid, in the source folder — the one handle that is still true on the server
 * whatever happened to the MOVE.
 *
 * 1. RECONCILED (expected) — the message no longer exists at the delete's
 *    source on IMAP, confirmed by {@link isMessageGoneFromOpenMailbox} rather
 *    than by a FETCH coming back empty. Either the MOVE (or EXPUNGE) did
 *    execute server-side and the connection dropped before the tagged OK was
 *    read, or a foreign client removed the message; from here those are
 *    indistinguishable and have the same answer. The stale Message and
 *    ThreadMessage rows are deleted via {@link reconcileStaleMessage} and the
 *    caller resyncs the folders, so whichever folder actually holds the
 *    message re-projects it with the server's own UID. That also clears the
 *    row Empty Trash would otherwise expunge by a uid belonging to another
 *    folder (#665, #979). Metric only, no alarm — routine.
 * 2. BROKEN — the message is still at the source, so the delete never took
 *    effect, but it keeps failing: broken code or a broken account, not a
 *    transient blip. Local state is left exactly as it stands. Reverting the
 *    optimistic delete here is what PR #652 was pulled for: a MOVE that ran
 *    server-side but dropped before the tagged OK is indistinguishable from
 *    one that never ran, and this path moves mail. Logged with an
 *    `alert`-shaped entry for an operator alarm; never re-thrown (terminal —
 *    the caller acks either way, since retrying a permanently-broken delete
 *    can never succeed).
 *
 * A server that cannot be reached at exhaustion time never reaches either
 * verdict: the probe throws and the record dead-letters with the row untouched.
 * Absence is only ever concluded from an answer the server gave.
 */
export const resolveExhaustedMessageDeleteFailure = async (
	deps: ResolveExhaustedMessageDeleteDeps,
	input: ResolveExhaustedMessageDeleteInput,
): Promise<ResolveExhaustedMessageDeleteResult> => {
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
				metric: "message_delete_stale_row_reconciled",
				accountId,
				accountConfigId,
				messageId,
				uid,
				sourceMailboxPath,
				threadMessagesDeleted,
			},
			"Message no longer at its delete source after retry exhaustion (the delete landed server-side, or an external delete or move); stale row reconciled",
		);
		return { outcome: "reconciled" };
	}

	deps.log.error(
		{
			alert: "message_delete_failed",
			accountId,
			accountConfigId,
			messageId,
			uid,
			sourceMailboxPath,
		},
		"Message delete could not be pushed to IMAP after retry exhaustion; message still exists at its source — local state left pending for operator investigation",
	);
	return { outcome: "broken" };
};
