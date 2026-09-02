import { getClient } from "@remit/backend/client";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import type { Logger } from "@remit/logger-lambda";
import {
	guardConnectionCursor,
	type IImapConnection,
	isCursorRebuildNeeded,
	isPlacementUnsettled,
	MailboxCursorPausedError,
	reconcileStaleMessage,
} from "@remit/mailbox-service";
import { isAccountDeleted } from "../account-check.js";
import { createConnectionScopeWithCredentials } from "../connection-scope.js";
import type { MessageCopyEvent } from "../events.js";
import { isNotFoundError } from "../is-not-found.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";
import { searchMailboxByMessageId } from "./message-move.js";

export interface MessageCopyDeps {
	getClient: typeof getClient;
	buildLifecycleDeps: typeof buildLifecycleDeps;
	withOAuthLifecycle: typeof withOAuthLifecycle;
	createConnectionScope: typeof createConnectionScopeWithCredentials;
}

const defaultDeps: MessageCopyDeps = {
	getClient,
	buildLifecycleDeps,
	withOAuthLifecycle,
	createConnectionScope: createConnectionScopeWithCredentials,
};

/**
 * Fallback when `MESSAGE_COPY_MAX_ATTEMPTS` is unset (local dev, unit tests).
 * Matches the `maxReceiveCount` the message queue's redrive policy uses
 * (`remit-messages.fifo`, `deploy/vps/queues.json`), same pattern as
 * `MESSAGE_MOVE_MAX_ATTEMPTS`.
 */
const DEFAULT_MESSAGE_COPY_MAX_ATTEMPTS = 3;

export const getMessageCopyMaxAttempts = (
	processEnv: NodeJS.ProcessEnv = process.env,
): number => {
	const raw = processEnv.MESSAGE_COPY_MAX_ATTEMPTS;
	if (!raw) return DEFAULT_MESSAGE_COPY_MAX_ATTEMPTS;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0
		? parsed
		: DEFAULT_MESSAGE_COPY_MAX_ATTEMPTS;
};

export const MESSAGE_COPY_MAX_ATTEMPTS = getMessageCopyMaxAttempts();

/**
 * Where the destination says this copy is. `unprobeable` is the row that
 * carries no Message-ID header (`messageIdHeader` is optional on Message, and
 * drafts and automated senders do arrive without one): the server was never
 * asked, so its silence says nothing.
 */
export type CopyProbe =
	| { kind: "confirmed"; uid: number }
	| { kind: "absent" }
	| { kind: "unprobeable" };

/**
 * Handle MESSAGE_COPY events.
 * Executes IMAP COPY command and updates local state with new UID.
 *
 * IMAP COPY is not idempotent and the message queue is FIFO per account, so
 * this handler never manufactures a retry to resolve an ambiguous answer: a
 * second COPY duplicates the mail, and a record that keeps coming back blocks
 * every later move, copy and delete for that account (issues #287, #289,
 * #290). Ambiguity is resolved in place, by asking the destination.
 *
 * A fault the server threw is still retried up to
 * {@link MESSAGE_COPY_MAX_ATTEMPTS}, because it may be a dropped connection.
 * Two guards make that safe: a redelivery asks the destination BEFORE issuing
 * COPY again, and the last attempt settles the row instead of dead-lettering
 * it. The copy row is a reconcile-model dependent (`copySettledMessage` writes
 * its ThreadMessage row at `uid: 0` before the server has confirmed anything,
 * docs/architecture/imap-mutations.md R2) and these terminal settles are its
 * reconciliation path: no outcome leaves the row at `uid: 0`/`moving` (#1097).
 */
export const handleMessageCopy = async (
	event: MessageCopyEvent,
	log: Logger,
	receiveCount = 1,
	deps: MessageCopyDeps = defaultDeps,
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
		sourceMessageId,
		newMessageId,
		sourceMailboxId,
		sourceMailboxPath,
		destinationMailboxPath,
		destinationMailboxId,
		uid,
	} = event;

	log.info(
		{
			event: event.type,
			accountId,
			sourceMessageId,
			newMessageId,
			from: sourceMailboxPath,
			to: destinationMailboxPath,
		},
		"Handling event",
	);

	const account = await accountService.get(accountId);
	if (!account) {
		throw new Error(`Account ${accountId} not found`);
	}

	if (isAccountDeleted(account, log)) {
		return;
	}

	const [copyRow] = await messageService.get([newMessageId]);

	// The copy row is already gone — a reconciliation path settled it. Nothing
	// left to bind a UID to; ack.
	if (!copyRow) {
		log.warn(
			{ accountId, sourceMessageId, newMessageId },
			"Skipping MESSAGE_COPY: copy row no longer exists",
		);
		return;
	}

	// This copy already settled — `updateUid` cleared `status: moving` when the
	// server confirmed it. A redelivery reaching here would COPY the message a
	// second time, and COPY has no source-side effect to make that a no-op.
	if (!isPlacementUnsettled(copyRow)) {
		log.info(
			{ accountId, newMessageId, uid: copyRow.uid, status: copyRow.status },
			"Skipping MESSAGE_COPY: the copy already settled against confirmed IMAP state",
		);
		return;
	}

	await withOAuthLifecycle(
		buildLifecycleDeps(secrets, accountService),
		account,
		log,
		async (credentials) => {
			// The source folder can be deleted between enqueue and this sync, leaving
			// a queued event pointing at a gone row. The lookup then throws
			// NotFoundError forever, and on the account's per-group FIFO that head
			// message stalls the whole pipeline (issues #287, #289, #290). A deleted
			// source mailbox makes the copy moot: ack with a WARN.
			const mailbox = await mailboxService
				.get(accountId, sourceMailboxId)
				.catch((error: unknown) => {
					if (isNotFoundError(error)) return null;
					throw error;
				});
			if (!mailbox) {
				log.warn(
					{ accountId, sourceMessageId, mailboxId: sourceMailboxId },
					"Skipping MESSAGE_COPY: source mailbox no longer exists (deleted)",
				);
				return;
			}

			// Cheap frugal skip (epic #1281 invariant 6): a mailbox already known
			// paused never even opens a connection. Optimization only — the
			// guardConnectionCursor openBox wrap below is the structural guarantee.
			if (isCursorRebuildNeeded(mailbox.cursorState)) {
				log.info(
					{ accountId, sourceMessageId, mailboxId: sourceMailboxId },
					"Mailbox cursor not normal; pausing outbound copy this round",
				);
				return;
			}

			// The copy row carries the source's Message-ID header, so the
			// destination can be asked where this copy is. Always on the UNGUARDED
			// handle: a `guardConnectionCursor` wrap is bound to the SOURCE mailbox
			// snapshot alone, and opening the destination through it trips that
			// mailbox into a rebuild.
			const probeDestination = async (
				connection: IImapConnection,
			): Promise<CopyProbe> => {
				if (!copyRow.messageIdHeader) return { kind: "unprobeable" };
				const probedUid = await searchMailboxByMessageId(
					connection,
					destinationMailboxPath,
					copyRow.messageIdHeader,
				);
				return probedUid === null
					? { kind: "absent" }
					: { kind: "confirmed", uid: probedUid };
			};

			const settleCopied = async (newUid: number): Promise<void> => {
				await messageService.updateUid(
					newMessageId,
					newUid,
					destinationMailboxId,
				);

				await messageService.update(newMessageId, {
					status: MessageStatus.active,
					syncStatus: MessageSyncStatus.synced,
				});

				const threadMessage = await threadMessageService.findByMessageId(
					account.accountConfigId,
					newMessageId,
				);
				if (threadMessage) {
					await threadMessageService.update(
						threadMessage.accountConfigId,
						threadMessage.threadMessageId,
						{ uid: newUid },
						{
							composites: {
								sentDate: threadMessage.sentDate,
								mailboxId: threadMessage.mailboxId,
								isRead: threadMessage.isRead,
								isDeleted: threadMessage.isDeleted,
								hasStars: threadMessage.hasStars,
								hasAttachment: threadMessage.hasAttachment,
							},
						},
					);
				}

				log.info(
					{
						sourceMessageId,
						newMessageId,
						oldUid: uid,
						newUid,
						destination: destinationMailboxPath,
					},
					"Message copied successfully",
				);
			};

			// The destination answered that it does not hold this message, so the
			// copy never landed and the optimistic row records something the server
			// does not have. Deleting it (with its ThreadMessage rows) is the exact
			// reality, the same terminal outcome `resolveExhaustedMessageMoveFailure`
			// calls `reconciled`. Routine: metric, no alarm.
			const settleNeverLanded = async (reason: string): Promise<void> => {
				const { threadMessagesDeleted } = await reconcileStaleMessage(
					{ messageService, threadMessageService },
					account.accountConfigId,
					newMessageId,
				);
				log.info(
					{
						metric: "message_copy_not_landed",
						accountId,
						sourceMessageId,
						newMessageId,
						destination: destinationMailboxPath,
						threadMessagesDeleted,
						reason,
					},
					"Copy absent from its destination; optimistic copy row reconciled away",
				);
			};

			// The server never answered where the copy is, so nothing here may
			// delete a row that might describe real mail. The row is settled out of
			// `moving` instead — `status: deleted` is the state this handler already
			// writes for a copy that will not happen, and it keeps `holdsCopyOf`
			// answering true so a sighting at the destination cannot drag the SOURCE
			// row out of the folder it was copied from.
			const settleBroken = async (reason: string): Promise<void> => {
				await messageService.update(newMessageId, {
					status: MessageStatus.deleted,
					syncStatus: MessageSyncStatus.failed,
				});
				log.error(
					{
						alert: "message_copy_unconfirmed",
						accountId,
						sourceMessageId,
						newMessageId,
						uid,
						destination: destinationMailboxPath,
						reason,
					},
					"Copy could not be bound to a destination UID; row settled failed for operator investigation",
				);
			};

			const scope = createConnectionScopeWithCredentials(account, credentials);

			await scope
				.getConnection()
				.then(async (rawConnection) => {
					// Guard at the openBox choke point (epic #1281 invariants 3 & 5):
					// a fresh mismatch trips the mailbox and throws once the SELECT
					// reveals it.
					const connection = guardConnectionCursor(
						rawConnection,
						{ mailboxService },
						accountId,
						mailbox,
					);

					// A redelivery means the previous attempt threw, which does not
					// mean its COPY failed — the tagged OK can be lost with the
					// connection. Ask before copying again, or the retry is what
					// duplicates the mail.
					if (receiveCount > 1) {
						const earlier = await probeDestination(rawConnection);
						if (earlier.kind === "confirmed") {
							await settleCopied(earlier.uid);
							return;
						}
					}

					// Open source mailbox (read-only is fine for COPY)
					await connection.openBox(sourceMailboxPath, true);

					// Execute IMAP COPY
					const result = await connection.copyMessages(
						[uid],
						destinationMailboxPath,
					);

					const copiedUid = result.uidMap.get(uid);
					if (copiedUid) {
						await settleCopied(copiedUid);
						return;
					}

					// A server without UIDPLUS answers a perfectly successful COPY
					// with no COPYUID entry, so an empty map is UNCONFIRMED, never
					// evidence the server matched nothing (#1097). The destination is
					// asked before any verdict, as `message-move.ts` does (#912, #979).
					const probe = await probeDestination(rawConnection);
					if (probe.kind === "confirmed") {
						await settleCopied(probe.uid);
						return;
					}
					if (probe.kind === "absent") {
						await settleNeverLanded(
							"no COPYUID entry, absent from destination",
						);
						return;
					}
					await settleBroken(
						"no COPYUID entry and no Message-ID to probe with",
					);
				})
				.catch(async (error: unknown) => {
					if (error instanceof MailboxCursorPausedError) {
						log.info(
							{
								accountId,
								sourceMessageId,
								mailboxId: sourceMailboxId,
								cursorState: error.state,
							},
							"Mailbox cursor not normal; pausing outbound copy this round",
						);
						return;
					}

					const errorMessage =
						error instanceof Error ? error.message : String(error);

					// Handle TRYCREATE - destination doesn't exist
					if (errorMessage.includes("TRYCREATE")) {
						log.info(
							{ destinationMailboxPath },
							"Destination mailbox doesn't exist, creating",
						);
						const connection = await scope.getConnection();
						await connection.createMailbox(destinationMailboxPath);
						// Re-throw to let the event be retried against the folder just
						// created. Kept unconditional past the attempt budget, as the
						// move path does: the destination now exists, so the record is
						// worth redriving from the DLQ.
						throw error;
					}

					// Handle source message not found on IMAP - already deleted (fail the copy)
					if (
						errorMessage.includes("not found") ||
						errorMessage.includes("NONEXISTENT")
					) {
						log.info(
							{ sourceMessageId, uid },
							"Source message not found on IMAP, marking copy as failed",
						);
						await messageService.update(newMessageId, {
							status: MessageStatus.deleted,
							syncStatus: MessageSyncStatus.failed,
						});
						return;
					}

					if (receiveCount < MESSAGE_COPY_MAX_ATTEMPTS) {
						// Transient copy failure — expected (connections drop). Queue
						// redelivery retries, and the probe above keeps the retry from
						// copying the message twice.
						await messageService.update(newMessageId, {
							syncStatus: MessageSyncStatus.failed,
						});
						throw error;
					}

					// Redelivery budget exhausted. Dead-lettering here would leave the
					// row at `uid: 0`/`moving` with nothing left to settle it and the
					// account's FIFO group still holding the record, so the row is
					// resolved into one terminal outcome instead — never by inferring
					// the server's state from our own failures. A server that cannot be
					// reached reaches no verdict: the probe throws and the record
					// dead-letters with the row untouched.
					const probe = await probeDestination(await scope.getConnection());
					if (probe.kind === "confirmed") {
						await settleCopied(probe.uid);
						return;
					}
					if (probe.kind === "absent") {
						await settleNeverLanded(`retry exhausted: ${errorMessage}`);
						return;
					}
					await settleBroken(`retry exhausted: ${errorMessage}`);
				})
				.finally(() => scope.disconnect());
		},
	);
};
