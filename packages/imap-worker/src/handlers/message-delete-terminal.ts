import type {
	IMessageRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import {
	type IImapConnection,
	isMessageGoneFromOpenMailbox,
	reconcileStaleMessage,
	type StaleMessageReconcileDeps,
} from "@remit/mailbox-service";
import { restoreSourcePlacement } from "./restore-source-placement.js";

export interface MessageDeleteTerminalLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	error(obj: Record<string, unknown>, msg: string): void;
}

export interface ResolveExhaustedMessageDeleteDeps
	extends StaleMessageReconcileDeps {
	messageService: Pick<IMessageRepository, "delete" | "updateUid">;
	threadMessageService: Pick<
		IThreadMessageRepository,
		"findAllByMessageId" | "deleteMany" | "update"
	>;
	log: MessageDeleteTerminalLogger;
}

export interface ResolveExhaustedMessageDeleteInput {
	accountId: string;
	accountConfigId: string;
	messageId: string;
	sourceMailboxId: string;
	uid: number;
	sourceMailboxPath: string;
	getConnection: () => Promise<IImapConnection>;
}

export type MessageDeleteTerminalOutcome = "reconciled" | "broken";

export interface ResolveExhaustedMessageDeleteResult {
	outcome: MessageDeleteTerminalOutcome;
}

/**
 * Resolve a MESSAGE_DELETE failure that has exhausted its redelivery budget
 * into exactly one of two terminal outcomes, mirroring
 * `resolveExhaustedMessageMoveFailure` for the same failure taxonomy (issue
 * #655) — no third, softer outcome.
 *
 * 1. RECONCILED (expected) — the message no longer exists at the delete's
 *    source on IMAP, confirmed by {@link isMessageGoneFromOpenMailbox} rather
 *    than by a FETCH coming back empty. The move to Trash landed server-side,
 *    or a foreign client moved or expunged the message; from here those are
 *    indistinguishable and have the same answer. The stale rows are deleted via
 *    {@link reconcileStaleMessage} and the caller resyncs the affected folders,
 *    so whichever folder actually holds the message re-projects it with the
 *    server's own UID. Metric only, no alarm — routine.
 * 2. BROKEN — the message is still at the source, so the delete never took
 *    effect, but it keeps failing: broken code or a broken account, not a
 *    transient blip. The row is put back where the server has just said the
 *    message is: `mailboxId` and `uid` return to the delete's source pair, and
 *    the thread rows lose the deletion mark the optimistic `updateForMove`
 *    wrote (issue #1098).
 *
 *    Settling `status` to `active` while leaving `mailboxId` on Trash is what
 *    this replaces. `bindsForeignUid` refuses a mismatched pair only while
 *    `status` is `moving`, so clearing it read as consistent, and the UI then
 *    offered "Delete permanently" on a Trash mailbox with the source folder's
 *    uid — an expunge naming a different message. Restoring the pair is not a
 *    revert on ambiguity (what PR #652 was pulled for): the presence probe
 *    above has just answered, so this writes a placement the server confirmed.
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
			sourceMailboxId,
			sourceMailboxPath,
		},
		"Delete could not be pushed to IMAP after retry exhaustion; the message is still at its source — row moved back to the source folder",
	);

	await restoreSourcePlacement(deps, {
		accountConfigId,
		messageId,
		sourceMailboxId,
		uid,
	});

	return { outcome: "broken" };
};
