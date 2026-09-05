import { getClient } from "@remit/backend/client";
import type {
	IMessageRepository,
	IThreadMessageRepository,
	MessageItem,
} from "@remit/data-ports";
import { isCurrentSchemaVersion } from "@remit/data-ports/mutation-events";
import { MessageSyncStatus } from "@remit/domain-enums";
import type { Logger } from "@remit/logger-lambda";
import { recordImapFailure } from "@remit/logger-lambda";
import {
	guardConnectionCursor,
	type IImapConnection,
	isCursorRebuildNeeded,
	isMessageGoneFromOpenMailbox,
	MailboxCursorPausedError,
} from "@remit/mailbox-service";
import { attemptBudget } from "@remit/sqs-client/attempt-budget";
import { isAccountDeleted } from "../account-check.js";
import { createConnectionScopeWithCredentials } from "../connection-scope.js";
import { emitEvent } from "../emit.js";
import type { MessageDeleteEvent } from "../events.js";
import { isNotFoundError } from "../is-not-found.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";
import { resolveExhaustedMessageDeleteFailure } from "./message-delete-terminal.js";
import {
	emitMoveResync,
	probePausedPlacement,
	searchMailboxForHighestMessageIdUid,
} from "./message-move.js";
import { restoreSourcePlacement } from "./restore-source-placement.js";
import { buildThreadMessageTrashUpdate } from "./thread-message-rows.js";

export const getMessageDeleteMaxAttempts = (
	processEnv: NodeJS.ProcessEnv = process.env,
): number => attemptBudget("MESSAGE_DELETE_MAX_ATTEMPTS", 3, processEnv);

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
 * Settle a move to Trash the server left unconfirmed, by asking it two
 * read-only questions instead of one. Both handles wrap the SAME connection but
 * are scoped to their own mailbox: a `guardConnectionCursor` wrap binds its
 * checks to the ONE mailbox snapshot it was built with, so the destination must
 * never be opened through the source's guard.
 *
 * The source is asked first, and a source that still holds the uid ends it: the
 * MOVE did not happen, so nothing at the destination can be this message. The
 * gate survives #1122's switch to the highest matching uid and is not made
 * redundant by it — highest picks the fresh copy out of several only once a
 * fresh copy exists, and where the MOVE never ran every hit at the destination
 * is an older copy of the same Message-ID (a sieve `fileinto` + `keep`, a
 * multi-label store, a resend) that `deriveMessageId` folds into this one local
 * row. An ungated probe hands back that copy's uid, and Empty Trash then
 * expunges by it. The gate also closes the second half of #912: an empty
 * `uidMap` can mean the MOVE matched nothing at all.
 *
 * A row with no `messageIdHeader`, and a row that is already deleted, have
 * nothing to probe with; they are distinct verdicts because no redelivery can
 * change either answer.
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

	const probedUid = await searchMailboxForHighestMessageIdUid(
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
 * A failing delete retries on redelivery until `receiveCount` reaches
 * {@link MESSAGE_DELETE_MAX_ATTEMPTS}, at which point
 * {@link resolveExhaustedMessageDeleteFailure} asks IMAP where the message
 * actually is and settles the row into one terminal outcome (issue #980).
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

	/**
	 * Undo the optimistic local delete, for every reason this handler has to
	 * give one up. The verdict differs — a refused event is a failure the row
	 * carries, a paused cursor is a mutation the server never heard of — but the
	 * way back is one rule, and it is the listing rows that pick it.
	 *
	 * Rows still there is the ordinary move to trash: the row goes back on the
	 * source pair, which is also the set the cursor rebuild adjudicates.
	 *
	 * No rows left is a permanent delete, which drops them at enqueue; they are
	 * denormalized off an envelope only the sync path shapes and cannot be
	 * rebuilt from here, so restoring the Message alone would leave mail nothing
	 * can list — the silent vanish rather than a visible failure. The local
	 * removal finishes instead. Nothing was expunged, so the server copy
	 * survives and the mailbox's own sync re-projects it, but local mail
	 * disappearing while the server still holds it alerts either way.
	 */
	const handBackDelete = async (
		syncStatus: MessageItem["syncStatus"],
	): Promise<void> => {
		const threadMessages = await threadMessageService.findAllByMessageId(
			account.accountConfigId,
			messageId,
		);

		if (threadMessages.length === 0) {
			log.error(
				{
					alert: "message_delete_abandoned_after_local_cleanup",
					accountId,
					messageId,
					uid,
					mailboxPath,
				},
				"Delete given up with no listing rows left to restore; the local row was removed and the server copy was not expunged",
			);
			await messageService.delete(messageId);
			return;
		}

		await restoreSourcePlacement(
			{ messageService, threadMessageService },
			{
				accountConfigId: account.accountConfigId,
				messageId,
				sourceMailboxId: mailboxId,
				uid,
				syncStatus,
			},
		);
	};

	// Only an operation that explicitly says so destroys mail. The event is
	// `JSON.parse`d and cast in the queue handler with no validation, so a
	// missing, misspelled or future field must abandon the delete — the
	// "anything that is not move_to_trash is an expunge" inference is the same
	// one that destroyed mail in the service, and an unrecoverable EXPUNGE is
	// not a default. Abandoning hands the row back where the server still has
	// it: an invisible `failed` on a row the user cannot see is the shape of
	// the incident this whole change is about. The row keeps `failed`, because
	// the product refused something the user asked for.
	const abandonDelete = async (
		reason: string,
		alert: string,
	): Promise<void> => {
		log.error(
			{ alert, accountId, messageId, uid, mailboxPath, operation },
			reason,
		);
		await handBackDelete(MessageSyncStatus.failed);
	};

	const settleTrashMoveConfirmed = async (
		newUid: number,
		trashMailboxId: string,
	): Promise<void> => {
		await messageService.updateUid(messageId, newUid, trashMailboxId);

		const threadMessage = await threadMessageService.findByMessageId(
			account.accountConfigId,
			messageId,
		);
		if (threadMessage) {
			const args = buildThreadMessageTrashUpdate(
				threadMessage,
				newUid,
				trashMailboxId,
			);
			await threadMessageService.update(
				threadMessage.accountConfigId,
				threadMessage.threadMessageId,
				args.set,
				{ composites: args.composites },
			);
		}

		log.info({ messageId, newUid }, "Message moved to trash");
	};

	/**
	 * Settle the optimistic local delete when a paused cursor stops this round
	 * from issuing it. Acking on the optimistic row strands it: nothing
	 * re-enqueues a MESSAGE_DELETE, and the cursor rebuild matches rows by
	 * `(accountConfigId, mailboxId)`, so it never even sees a move-to-trash row
	 * that already names Trash (issue #1203).
	 *
	 * The delete therefore reconciles rather than waits (R2,
	 * docs/architecture/imap-mutations.md): the row is settled onto whichever
	 * pair the server can be shown to hold, and the resync plus the source's own
	 * cursor rebuild are its repair path.
	 *
	 * A first delivery has provably issued neither the MOVE nor the EXPUNGE —
	 * every paused exit is thrown by the openBox guard before them — so undoing
	 * the local write claims nothing about the server. A redelivery cannot say
	 * that: the earlier attempt's tagged OK can be lost with the connection, and
	 * handing back on that assumption writes `synced` onto INBOX for mail the
	 * server already holds in Trash. It asks {@link probePausedPlacement}
	 * instead, on the unguarded handle, and settles the trash move where the
	 * destination confirms it. A permanent delete has nothing to ask: its answer
	 * is the same either way, since the row is unlistable and goes.
	 */
	const settlePausedDelete = async (
		getRawConnection: () => Promise<IImapConnection>,
	): Promise<void> => {
		const isRedeliveredTrashMove =
			receiveCount > 1 &&
			operation === "move_to_trash" &&
			destinationMailboxId !== undefined &&
			destinationMailboxPath !== undefined;

		if (isRedeliveredTrashMove) {
			const [message] = await messageService.get([messageId]);
			const placement = await probePausedPlacement(await getRawConnection(), {
				messageIdHeader: message?.messageIdHeader,
				sourceMailboxPath: mailboxPath,
				destinationMailboxPath,
			});
			if (placement.kind === "at-destination") {
				await settleTrashMoveConfirmed(placement.uid, destinationMailboxId);
				await emitMoveResync(emitEvent, {
					accountId,
					sourceMailboxId: mailboxId,
					destinationMailboxId,
				});
				return;
			}
		}

		// `gone` and `unprobeable` land here with the rest: the source pair is the
		// set the rebuild walks, and a row it cannot match against a fresh
		// envelope snapshot is the one thing it reconciles away.
		await handBackDelete(MessageSyncStatus.synced);

		if (destinationMailboxId) {
			await emitMoveResync(emitEvent, {
				accountId,
				sourceMailboxId: mailboxId,
				destinationMailboxId,
			});
		}
	};

	const settleExhaustedDelete = async (
		accountConfigId: string,
		getConnection: () => Promise<IImapConnection>,
		settlePaused: () => Promise<void>,
	): Promise<void> => {
		const settled = await resolveExhaustedMessageDeleteFailure(
			{ messageService, threadMessageService, log },
			{
				accountId,
				accountConfigId,
				messageId,
				sourceMailboxId: mailboxId,
				uid,
				sourceMailboxPath: mailboxPath,
				getConnection,
			},
		).catch(async (settleError: unknown) => {
			// The guarded probe found a mailbox whose UIDVALIDITY has moved. Nothing
			// may be settled off a uid on a dead axis, and the pause is the routine
			// skip `guardMailboxCursor` documents, not a fault to re-throw out of
			// the caller's catch. The delete is still settled, on the identity axis
			// instead: the paused settle asks by Message-ID, which a UIDVALIDITY
			// change does not invalidate.
			if (settleError instanceof MailboxCursorPausedError) {
				log.info(
					{ accountId, messageId, mailboxId, cursorState: settleError.state },
					"Mailbox cursor not normal; settling the exhausted delete against the server by Message-ID",
				);
				await settlePaused();
				return null;
			}
			throw settleError;
		});

		if (!settled) return;

		if (settled.outcome === "broken") {
			recordImapFailure("MESSAGE_DELETE_EXHAUSTED", "other");
		}

		// Both verdicts end in a row the server has contradicted, so this delete
		// reconciles rather than waits (R2): whichever folder actually holds the
		// message re-projects it with the server's own uid. RECONCILED, the local
		// rows are gone and the resync rebuilds them. BROKEN, the row has just
		// been put back at the source the server confirmed, and the resync is
		// what carries any drift either folder has picked up since.
		if (destinationMailboxId) {
			await emitMoveResync(emitEvent, {
				accountId,
				sourceMailboxId: mailboxId,
				destinationMailboxId,
			});
		}
	};

	/**
	 * Decide what an unconfirmed move to Trash does with this delivery. The
	 * settle itself is `resolveExhaustedMessageDeleteFailure`, reached through
	 * the attempt budget in the catch below — the two verdicts handled here are
	 * the ones a redelivery could never answer.
	 */
	const settleUnconfirmedTrashMove = async (
		confirmation: Exclude<TrashMoveConfirmation, { outcome: "confirmed" }>,
		accountConfigId: string,
		getConnection: () => Promise<IImapConnection>,
		settlePaused: () => Promise<void>,
	): Promise<void> => {
		const context = {
			accountId,
			accountConfigId,
			messageId,
			uid,
			mailboxPath,
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

		if (confirmation.outcome === "unprobeable") {
			recordImapFailure("MESSAGE_DELETE_TRASH_MOVE_UNCONFIRMED", "other");
			log.info(
				context,
				"Move to trash carries no Message-ID header to probe the destination with; settling on the source's answer alone",
			);
			await settleExhaustedDelete(accountConfigId, getConnection, settlePaused);
			return;
		}

		throw new Error(
			`Move to trash unconfirmed for message ${messageId} (attempt ${receiveCount}/${MESSAGE_DELETE_MAX_ATTEMPTS})`,
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

			const scope = createConnectionScopeWithCredentials(account, credentials);

			// The terminal resolver opens the source itself, and its answer now
			// WRITES a placement, so it has to reach IMAP through the same
			// UIDVALIDITY choke point every other outbound operation does. An
			// unguarded probe on a folder that was deleted and recreated finds
			// whatever the server has renumbered onto this uid, reads it as "still
			// at source", and binds the row to a stranger the next permanent delete
			// would expunge.
			const getGuardedConnection = async (): Promise<IImapConnection> =>
				guardConnectionCursor(
					await scope.getConnection(),
					{ mailboxService },
					accountId,
					mailbox,
				);

			const settlePaused = (): Promise<void> =>
				settlePausedDelete(scope.getConnection);

			// Cheap frugal skip (epic #1281 invariant 6): a mailbox already known
			// paused never opens a connection on a first delivery. Optimization
			// only — the guardConnectionCursor openBox wrap below is the structural
			// guarantee.
			if (isCursorRebuildNeeded(mailbox.cursorState)) {
				log.info(
					{ accountId, messageId, mailboxId },
					"Mailbox cursor not normal; pausing outbound delete this round and settling the row against the server",
				);
				await settlePaused().finally(() => scope.disconnect());
				return;
			}

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
						// `attemptMove` do (issues #979, #665). A probe the server refused
						// says nothing either way and counts as unconfirmed.
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
							await settleTrashMoveConfirmed(
								confirmation.uid,
								destinationMailboxId,
							);
							return;
						}

						await settleUnconfirmedTrashMove(
							confirmation,
							account.accountConfigId,
							getGuardedConnection,
							settlePaused,
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
							"Mailbox cursor not normal; pausing outbound delete this round and settling the row against the server",
						);
						await settlePaused();
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

					if (receiveCount < MESSAGE_DELETE_MAX_ATTEMPTS) {
						// Transient failure — connections drop. No alarm; redelivery
						// retries, and `failed` marks the row unsettled meanwhile. It is
						// not a terminal signal: only the resolver below settles anything.
						await messageService.update(messageId, {
							syncStatus: MessageSyncStatus.failed,
						});
						throw error;
					}

					// Budget exhausted. Settling here is what keeps a throwing
					// `moveMessages` inside the ceiling: re-MOVEing a uid the source no
					// longer holds fails identically on every redelivery, which is the
					// failure this budget exists for.
					await settleExhaustedDelete(
						account.accountConfigId,
						getGuardedConnection,
						settlePaused,
					);
					log.error(
						{ accountId, messageId, uid, mailboxPath, error: errorMessage },
						"Delete retry exhausted; settled into a terminal outcome",
					);
				})
				.finally(() => scope.disconnect());
		},
	);
};
