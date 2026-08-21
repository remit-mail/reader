import { getClient } from "@remit/backend/client";
import type {
	IThreadMessageRepository,
	ThreadMessageItem,
} from "@remit/data-ports";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import type { Logger } from "@remit/logger-lambda";
import {
	guardConnectionCursor,
	isCursorRebuildNeeded,
	isMessageGoneFromOpenMailbox,
	MailboxCursorPausedError,
} from "@remit/mailbox-service";
import { isAccountDeleted } from "../account-check.js";
import { createConnectionScopeWithCredentials } from "../connection-scope.js";
import { isCurrentSchemaVersion, type MessageDeleteEvent } from "../events.js";
import { isNotFoundError } from "../is-not-found.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";

/**
 * Delete every ThreadMessage row that points at this messageId.
 *
 * A single Message can have multiple ThreadMessage rows — one per mailbox
 * the message exists in (e.g. INBOX + a label/folder copy). Permanent-delete
 * cleanup must remove ALL of them; using `findByMessageId` (single row) leaves
 * orphan rows in other mailboxes that then leak into their listings. See
 * issue #212.
 */
export const deleteAllThreadMessagesForMessage = async (
	threadMessageService: Pick<
		IThreadMessageRepository,
		"findAllByMessageId" | "delete"
	>,
	accountConfigId: string,
	messageId: string,
): Promise<number> => {
	const rows = await threadMessageService.findAllByMessageId(
		accountConfigId,
		messageId,
	);
	for (const row of rows) {
		await threadMessageService.delete(row.accountConfigId, row.threadMessageId);
	}
	return rows.length;
};

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
type ThreadMessageRowState = Pick<
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
 * the server. The delete was recorded optimistically, so a delete abandoned
 * before any IMAP write has to hand the row back rather than leave it claiming
 * Trash — an invisible `failed` on a row the user cannot see is the shape of
 * the incident this whole change is about.
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

export interface MessageDeleteDeps {
	getClient: typeof getClient;
	buildLifecycleDeps: typeof buildLifecycleDeps;
	withOAuthLifecycle: typeof withOAuthLifecycle;
	createConnectionScope: typeof createConnectionScopeWithCredentials;
}

const defaultDeps: MessageDeleteDeps = {
	getClient,
	buildLifecycleDeps,
	withOAuthLifecycle,
	createConnectionScope: createConnectionScopeWithCredentials,
};

/**
 * Handle MESSAGE_DELETE events.
 * Either moves to Trash (IMAP MOVE) or permanently deletes (IMAP DELETE).
 */
export const handleMessageDelete = async (
	event: MessageDeleteEvent,
	log: Logger,
	deps: MessageDeleteDeps = defaultDeps,
): Promise<void> => {
	const {
		getClient,
		buildLifecycleDeps,
		withOAuthLifecycle,
		createConnectionScope: createConnectionScopeWithCredentials,
	} = deps;

	const {
		account: accountService,
		message: messageService,
		threadMessage: threadMessageService,
		mailbox: mailboxService,
		secrets,
	} = await getClient();

	const {
		accountId,
		messageId,
		mailboxId,
		mailboxPath,
		uid,
		operation,
		destinationMailboxId,
		destinationMailboxPath,
	} = event;

	log.info(
		{ event: event.type, accountId, messageId, mailboxPath, operation },
		"Handling event",
	);

	const account = await accountService.get(accountId);
	if (!account) {
		throw new Error(`Account ${accountId} not found`);
	}

	if (isAccountDeleted(account, log)) {
		return;
	}

	// Only an operation that explicitly says so destroys mail. The event is
	// `JSON.parse`d and cast in the queue handler with no validation, so a
	// missing, misspelled or future field must abandon the delete — the
	// "anything that is not move_to_trash is an expunge" inference is the same
	// one that destroyed mail in the service, and an unrecoverable EXPUNGE is
	// not a default. Abandoning hands the row back where the server still has
	// it: an invisible `failed` on a row the user cannot see is the shape of
	// the incident this whole change is about.
	const abandonDelete = async (
		reason: string,
		alert: string,
	): Promise<void> => {
		log.error(
			{ alert, accountId, messageId, uid, mailboxPath, operation },
			reason,
		);
		await messageService.updateUid(messageId, uid, mailboxId);
		await messageService.update(messageId, {
			status: MessageStatus.active,
			syncStatus: MessageSyncStatus.failed,
		});
		const threadMessage = await threadMessageService.findByMessageId(
			account.accountConfigId,
			messageId,
		);
		if (!threadMessage) return;
		const args = buildThreadMessageMoveRevert(threadMessage, uid, mailboxId);
		await threadMessageService.update(
			threadMessage.accountConfigId,
			threadMessage.threadMessageId,
			args.set,
			{ composites: args.composites },
		);
	};

	if (!isCurrentSchemaVersion(event.schemaVersion)) {
		await abandonDelete(
			"Refused to delete: event was minted under an unknown contract",
			"message_delete_unknown_schema_version",
		);
		return;
	}

	await withOAuthLifecycle(
		buildLifecycleDeps(secrets, accountService),
		account,
		log,
		async (credentials) => {
			// The folder can be deleted between enqueue and this sync, leaving a
			// queued event pointing at a gone row. The lookup then throws
			// NotFoundError forever, and on the account's per-group FIFO that head
			// message stalls the whole pipeline (issues #287, #289, #290). A deleted
			// mailbox makes the delete moot: ack with a WARN.
			const mailbox = await mailboxService
				.get(accountId, mailboxId)
				.catch((error: unknown) => {
					if (isNotFoundError(error)) return null;
					throw error;
				});
			if (!mailbox) {
				log.warn(
					{ accountId, messageId, mailboxId },
					"Skipping MESSAGE_DELETE: mailbox no longer exists (deleted)",
				);
				return;
			}

			// Cheap frugal skip (epic #1281 invariant 6): a mailbox already known
			// paused never even opens a connection. Optimization only — the
			// guardConnectionCursor openBox wrap below is the structural guarantee.
			if (isCursorRebuildNeeded(mailbox.cursorState)) {
				log.info(
					{ accountId, messageId, mailboxId },
					"Mailbox cursor not normal; pausing outbound delete this round",
				);
				return;
			}

			const scope = createConnectionScopeWithCredentials(account, credentials);

			await scope
				.getConnection()
				.then(async (rawConnection) => {
					// Guard at the openBox choke point (epic #1281 invariants 3 & 5):
					// a fresh mismatch trips the mailbox and throws once the SELECT
					// reveals it. The delete stays applied locally either way.
					const connection = guardConnectionCursor(
						rawConnection,
						{ mailboxService },
						accountId,
						mailbox,
					);
					await connection.openBox(mailboxPath, false);

					if (
						operation !== "move_to_trash" &&
						operation !== "permanent_delete"
					) {
						await abandonDelete(
							"Refused to delete: event carries an unrecognized operation",
							"message_delete_unknown_operation",
						);
					} else if (
						operation === "move_to_trash" &&
						(!destinationMailboxPath || !destinationMailboxId)
					) {
						// Defence in depth. `MessageMoveService` always sets both fields,
						// so nothing mints such an event today; the guard exists so that
						// a future producer that forgets one cannot reach the expunge.
						await abandonDelete(
							"Refused to delete: move to trash carries no destination mailbox",
							"message_delete_missing_destination",
						);
					} else if (operation === "move_to_trash" && destinationMailboxPath) {
						// Move to Trash
						const result = await connection.moveMessages(
							[uid],
							destinationMailboxPath,
						);
						const newUid = result.uidMap.get(uid);

						if (newUid && destinationMailboxId) {
							// Update message with new UID in Trash
							await messageService.updateUid(
								messageId,
								newUid,
								destinationMailboxId,
							);

							// Update ThreadMessage with new UID and isDeleted = true
							const threadMessage = await threadMessageService.findByMessageId(
								account.accountConfigId,
								messageId,
							);
							if (threadMessage) {
								const args = buildThreadMessageTrashUpdate(
									threadMessage,
									newUid,
									destinationMailboxId,
								);
								await threadMessageService.update(
									threadMessage.accountConfigId,
									threadMessage.threadMessageId,
									args.set,
									{ composites: args.composites },
								);
							}

							log.info({ messageId, newUid }, "Message moved to trash");
						} else {
							log.error(
								{ messageId, uid },
								"Failed to get new UID after move to trash",
							);
							await messageService.update(messageId, {
								syncStatus: MessageSyncStatus.failed,
							});
						}
					} else {
						// Permanent delete — reached only by `operation === "permanent_delete"`.
						await connection.deleteMessages([uid]);

						// Delete ThreadMessage rows BEFORE the Message row to collapse the
						// visibility window where the inbox lists a row whose backing
						// Message has already been deleted (see issue #212). Multi-mailbox
						// copies are handled by the helper.
						const threadMessagesDeleted =
							await deleteAllThreadMessagesForMessage(
								threadMessageService,
								account.accountConfigId,
								messageId,
							);

						// Delete local Message entity
						await messageService.delete(messageId);

						log.info(
							{ messageId, threadMessagesDeleted },
							"Message permanently deleted",
						);
					}
				})
				.catch(async (error: unknown) => {
					if (error instanceof MailboxCursorPausedError) {
						log.info(
							{ accountId, messageId, mailboxId, cursorState: error.state },
							"Mailbox cursor not normal; pausing outbound delete this round",
						);
						return;
					}

					const errorMessage =
						error instanceof Error ? error.message : String(error);

					// Reconcile a permanent delete the server already applied (#212).
					// The error text only nominates a candidate — the source box
					// decides, since a landed move-to-trash reports that same text from
					// a LOCAL lookup (#845) — and a probe that cannot answer counts as
					// not-confirmed, leaving the original error to the rethrow below.
					const isGoneFromSource =
						operation === "permanent_delete" &&
						(errorMessage.includes("not found") ||
							errorMessage.includes("NONEXISTENT")) &&
						(await scope
							.getConnection()
							.then((connection) =>
								isMessageGoneFromOpenMailbox(connection, uid),
							)
							.catch((probeError: unknown) => {
								log.warn(
									{ messageId, uid, mailboxPath, probeError },
									"Could not confirm whether the message is gone; keeping local rows",
								);
								return false;
							}));

					if (isGoneFromSource) {
						log.info(
							{ messageId, uid },
							"Message confirmed gone from IMAP, cleaning up local",
						);
						// Clean up local entities. Multi-mailbox copies are handled by the
						// helper so we don't leave orphan rows (see issue #212).
						await messageService.delete(messageId);
						await deleteAllThreadMessagesForMessage(
							threadMessageService,
							account.accountConfigId,
							messageId,
						);
						return;
					}

					// TRYCREATE — the destination this event names is not on the
					// server. Creating it would resurrect an empty `Trash` beside the
					// real one and hand the name-hint rule two folders to choose
					// between; the folder picker offers the ones that exist instead.
					if (errorMessage.includes("TRYCREATE") && destinationMailboxPath) {
						await abandonDelete(
							"Refused to delete: the destination mailbox does not exist on the server",
							"message_delete_destination_missing",
						);
						return;
					}

					// Mark as failed for other errors
					await messageService.update(messageId, {
						syncStatus: MessageSyncStatus.failed,
					});
					throw error;
				})
				.finally(() => scope.disconnect());
		},
	);
};
