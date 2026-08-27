import { getClient } from "@remit/backend/client";
import type {
	IMessageRepository,
	IThreadMessageRepository,
	ThreadMessageItem,
} from "@remit/data-ports";
import { isCurrentSchemaVersion } from "@remit/data-ports/mutation-events";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import type { Logger } from "@remit/logger-lambda";
import { recordImapFailure } from "@remit/logger-lambda";
import {
	guardConnectionCursor,
	type IImapConnection,
	isCursorRebuildNeeded,
	isMessageGoneFromOpenMailbox,
	MailboxCursorPausedError,
	reconcileStaleMessage,
} from "@remit/mailbox-service";
import { isAccountDeleted } from "../account-check.js";
import { createConnectionScopeWithCredentials } from "../connection-scope.js";
import { emitEvent } from "../emit.js";
import type { MessageDeleteEvent } from "../events.js";
import { isNotFoundError } from "../is-not-found.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";
import { emitMoveResync, searchMailboxByMessageId } from "./message-move.js";

/**
 * Fallback when `MESSAGE_DELETE_MAX_ATTEMPTS` is unset (local dev, unit tests).
 * Matches the `maxReceiveCount` the mailbox queue's redrive policy uses
 * (`remit-mailboxes.fifo`, `deploy/vps/queues.json`), same pattern as
 * `MESSAGE_MOVE_MAX_ATTEMPTS` and `FLAG_PUSH_MAX_ATTEMPTS`.
 */
const DEFAULT_MESSAGE_DELETE_MAX_ATTEMPTS = 3;

export const getMessageDeleteMaxAttempts = (
	processEnv: NodeJS.ProcessEnv = process.env,
): number => {
	const raw = processEnv.MESSAGE_DELETE_MAX_ATTEMPTS;
	if (!raw) return DEFAULT_MESSAGE_DELETE_MAX_ATTEMPTS;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0
		? parsed
		: DEFAULT_MESSAGE_DELETE_MAX_ATTEMPTS;
};

export const MESSAGE_DELETE_MAX_ATTEMPTS = getMessageDeleteMaxAttempts();

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

/**
 * Settle a move to Trash the server left unconfirmed, by asking it two
 * read-only questions instead of one. Both handles wrap the SAME connection but
 * are scoped to their own mailbox: a `guardConnectionCursor` wrap binds its
 * checks to the ONE mailbox snapshot it was built with, so the destination must
 * never be opened through the source's guard.
 *
 * The source is asked first, and a source that still holds the uid ends it: the
 * MOVE did not happen, so nothing at the destination can be this message.
 * Skipping that question is not safe, because `searchMailboxByMessageId`
 * returns the LOWEST matching uid rather than the one that just arrived, and
 * one Message-ID can have several server copies in one account (a sieve
 * `fileinto` + `keep`, a multi-label store, a resend) while
 * `deriveMessageId` is folder-independent and gives them one local row. An
 * ungated probe can hand back an earlier copy's uid, and Empty Trash then
 * expunges by that uid. It also closes the second half of #912: an empty
 * `uidMap` can mean the MOVE matched nothing at all.
 *
 * The verdict is a union rather than a nullable uid because the ways this can
 * end are not one outcome: they differ in whether a redelivery could ever
 * change the answer, which is what the attempt budget spends itself on.
 */
export type TrashMoveConfirmation =
	| { outcome: "confirmed"; uid: number }
	| { outcome: "still-at-source" }
	| { outcome: "row-gone" }
	| { outcome: "unprobeable" }
	| { outcome: "unconfirmed" };

const confirmTrashMoveUid = async (
	sourceConnection: IImapConnection,
	destinationConnection: IImapConnection,
	messageService: Pick<IMessageRepository, "get">,
	messageId: string,
	sourceMailboxPath: string,
	destinationMailboxPath: string,
	uid: number,
): Promise<TrashMoveConfirmation> => {
	await sourceConnection.openBox(sourceMailboxPath, true);
	if (!(await isMessageGoneFromOpenMailbox(sourceConnection, uid))) {
		return { outcome: "still-at-source" };
	}

	const [message] = await messageService.get([messageId]);
	if (!message) return { outcome: "row-gone" };
	if (!message.messageIdHeader) return { outcome: "unprobeable" };

	const probedUid = await searchMailboxByMessageId(
		destinationConnection,
		destinationMailboxPath,
		message.messageIdHeader,
	);
	return probedUid === null
		? { outcome: "unconfirmed" }
		: { outcome: "confirmed", uid: probedUid };
};

export interface MessageDeleteDeps {
	getClient: typeof getClient;
	buildLifecycleDeps: typeof buildLifecycleDeps;
	withOAuthLifecycle: typeof withOAuthLifecycle;
	createConnectionScope: typeof createConnectionScopeWithCredentials;
	emitEvent: typeof emitEvent;
}

const defaultDeps: MessageDeleteDeps = {
	getClient,
	buildLifecycleDeps,
	withOAuthLifecycle,
	createConnectionScope: createConnectionScopeWithCredentials,
	emitEvent,
};

/**
 * Handle MESSAGE_DELETE events.
 * Either moves to Trash (IMAP MOVE) or permanently deletes (IMAP DELETE).
 *
 * An unconfirmed move to Trash retries on SQS redelivery until `receiveCount`
 * reaches {@link MESSAGE_DELETE_MAX_ATTEMPTS}, then settles once into the same
 * two terminal outcomes `resolveExhaustedMessageMoveFailure` uses (issue #655).
 * Without the budget the branch could only mark the row and ack, because a bare
 * throw would redeliver forever and head-of-line block the account's whole
 * delete pipeline (issues #287, #289, #290, #980).
 */
export const handleMessageDelete = async (
	event: MessageDeleteEvent,
	log: Logger,
	receiveCount = 1,
	deps: MessageDeleteDeps = defaultDeps,
): Promise<void> => {
	const {
		getClient,
		buildLifecycleDeps,
		withOAuthLifecycle,
		createConnectionScope: createConnectionScopeWithCredentials,
		emitEvent,
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

		const threadMessages = await threadMessageService.findAllByMessageId(
			account.accountConfigId,
			messageId,
		);

		// A permanent delete removes the listing rows before it enqueues, and
		// they cannot be rebuilt from here — the row is denormalized off an
		// envelope only the sync path shapes. Restoring the Message alone would
		// leave mail nothing can list, which is the silent vanish rather than a
		// visible failure, so the local removal finishes instead. The server copy
		// survives (nothing was expunged) and a full sync of the mailbox brings
		// it back. Reachable only through the rollout window, where a v1 event
		// carries no `schemaVersion`.
		if (threadMessages.length === 0) {
			log.error(
				{
					alert: "message_delete_abandoned_after_local_cleanup",
					accountId,
					messageId,
					uid,
					mailboxPath,
				},
				"Abandoned delete had no listing rows left to restore; the server copy was not expunged",
			);
			await messageService.delete(messageId);
			return;
		}

		await messageService.updateUid(messageId, uid, mailboxId);
		await messageService.update(messageId, {
			status: MessageStatus.active,
			syncStatus: MessageSyncStatus.failed,
		});
		for (const threadMessage of threadMessages) {
			const args = buildThreadMessageMoveRevert(threadMessage, uid, mailboxId);
			await threadMessageService.update(
				threadMessage.accountConfigId,
				threadMessage.threadMessageId,
				args.set,
				{ composites: args.composites },
			);
		}
	};

	/**
	 * Settle a move to Trash the server never confirmed, into the two terminal
	 * outcomes `resolveExhaustedMessageMoveFailure` already uses (issue #655).
	 *
	 * Two verdicts can never become confirmed by a redelivery, so they settle on
	 * the first attempt rather than spending the budget on an answer that cannot
	 * change: a Message row that is already deleted has nothing to settle, and a
	 * message with no `Message-ID` header on a non-UIDPLUS server has nothing to
	 * probe the destination with.
	 *
	 * RECONCILED — the source no longer holds the uid, so the MOVE did land (or
	 * another client moved the message). The stale rows go and both folders
	 * resync, so whichever folder actually holds the message re-projects it with
	 * the server's own uid. That is the settled state a reader can see: the row
	 * stops claiming a uid nothing on the server has. `updateForMove` already
	 * persisted `originalMailboxId`/`originalUid`, so nothing extra is needed to
	 * find it again.
	 *
	 * BROKEN — the source still holds the uid, so the MOVE never took effect and
	 * keeps failing: broken code or a broken account, not a transient blip. Local
	 * state is left exactly as it stands; reverting on this ambiguity is the
	 * blind revert PR #652 was pulled for. Alert-shaped log plus the failure
	 * metric, and never re-thrown — retrying a permanently broken delete cannot
	 * succeed, and a bare rethrow head-of-line blocks the account's per-group
	 * FIFO (issues #287, #289, #290).
	 */
	const settleUnconfirmedTrashMove = async (
		confirmation: Exclude<TrashMoveConfirmation, { outcome: "confirmed" }>,
		accountConfigId: string,
		trashMailboxId: string,
		trashMailboxPath: string,
	): Promise<void> => {
		const context = {
			accountId,
			accountConfigId,
			messageId,
			uid,
			mailboxPath,
			destinationMailboxPath: trashMailboxPath,
			receiveCount,
			confirmation: confirmation.outcome,
		};

		if (confirmation.outcome === "row-gone") {
			log.warn(
				context,
				"Move to trash unconfirmed and the local row is already gone; nothing left to settle",
			);
			return;
		}

		if (
			confirmation.outcome !== "unprobeable" &&
			receiveCount < MESSAGE_DELETE_MAX_ATTEMPTS
		) {
			// `failed` marks the row unsettled while the queue redelivers. It is
			// not a terminal signal — only the branches below settle anything.
			await messageService.update(messageId, {
				syncStatus: MessageSyncStatus.failed,
			});
			log.warn(
				context,
				"Move to trash unconfirmed: no COPYUID entry and the destination did not answer; retrying on redelivery",
			);
			throw new Error(
				`Move to trash unconfirmed for message ${messageId} (attempt ${receiveCount}/${MESSAGE_DELETE_MAX_ATTEMPTS})`,
			);
		}

		if (confirmation.outcome === "still-at-source") {
			await messageService.update(messageId, {
				syncStatus: MessageSyncStatus.failed,
			});
			recordImapFailure("MESSAGE_DELETE_EXHAUSTED", "other");
			log.error(
				{ ...context, alert: "message_delete_failed" },
				"Delete could not be pushed to IMAP after retry exhaustion; the message is still at its source — local state left pending for operator investigation",
			);
			return;
		}

		if (confirmation.outcome === "unprobeable") {
			// A message with no Message-ID header on a non-UIDPLUS server can
			// never be confirmed at the destination, so the row settles on the
			// source's answer alone — weaker evidence than the sibling handlers
			// need, and counted as a failure for that reason.
			recordImapFailure("MESSAGE_DELETE_TRASH_MOVE_UNCONFIRMED", "other");
			log.error(
				{ ...context, alert: "message_delete_trash_move_unprobeable" },
				"Move to trash could never be confirmed: the row carries no Message-ID header to probe the destination with",
			);
		}

		const { threadMessagesDeleted } = await reconcileStaleMessage(
			{ messageService, threadMessageService },
			accountConfigId,
			messageId,
		);
		log.info(
			{
				...context,
				metric: "message_delete_stale_row_reconciled",
				threadMessagesDeleted,
			},
			"Message no longer at its delete source (the move to trash landed server-side, or an external delete or move); stale row reconciled and both folders resynced",
		);
		await emitMoveResync(emitEvent, {
			accountId,
			sourceMailboxId: mailboxId,
			destinationMailboxId: trashMailboxId,
		});
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
					} else if (
						operation === "move_to_trash" &&
						destinationMailboxPath &&
						destinationMailboxId
					) {
						// Move to Trash
						const result = await connection.moveMessages(
							[uid],
							destinationMailboxPath,
						);

						// UIDPLUS is an extension. A server without it answers a
						// perfectly successful MOVE with no COPYUID entry, so an empty
						// map is UNCONFIRMED, never evidence the move failed: the server
						// is asked before any verdict, exactly as `handleMessageMove` and
						// `attemptMove` do. Reading the empty map as a failure left the
						// message in Trash under a uid nothing local knew, while the row
						// kept the SOURCE folder's uid — which Empty Trash then decides
						// by (issues #979, #665).
						//
						// A probe the server refused says nothing either way, so it
						// counts as unconfirmed and spends an attempt rather than
						// deciding anything.
						const copyUid = result.uidMap.get(uid);
						const confirmation: TrashMoveConfirmation = copyUid
							? { outcome: "confirmed", uid: copyUid }
							: await confirmTrashMoveUid(
									connection,
									rawConnection,
									messageService,
									messageId,
									mailboxPath,
									destinationMailboxPath,
									uid,
								).catch((probeError: unknown) => {
									log.warn(
										{
											messageId,
											uid,
											mailboxPath,
											destinationMailboxPath,
											probeError,
										},
										"Could not confirm the move to trash; keeping local rows",
									);
									return { outcome: "unconfirmed" } as const;
								});

						if (confirmation.outcome === "confirmed") {
							const newUid = confirmation.uid;
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
							return;
						}

						await settleUnconfirmedTrashMove(
							confirmation,
							account.accountConfigId,
							destinationMailboxId,
							destinationMailboxPath,
						);
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
