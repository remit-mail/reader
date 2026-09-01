import { getClient } from "@remit/backend/client";
import type { IMessageRepository } from "@remit/data-ports";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import type { Logger } from "@remit/logger-lambda";
import {
	guardConnectionCursor,
	type IImapConnection,
	isCursorRebuildNeeded,
	MailboxCursorPausedError,
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
 * Probe the destination mailbox by the source row's RFC822 Message-ID header
 * when the COPYUID response names no uid — the fallback for servers without
 * UIDPLUS, which answer a perfectly successful COPY with no COPYUID entry.
 * Read-only (EXAMINE). Returns the first matching UID, or `null` when the
 * source row is gone, carries no Message-ID header, or nothing matched.
 *
 * The probe goes through the RAW connection: a `guardConnectionCursor` wrap
 * binds its checks to the ONE mailbox snapshot it was built with, so the
 * destination must never be opened through the source's guard (see
 * `confirmTrashMoveUid` in message-delete.ts).
 */
const probeDestinationByMessageId = async (
	rawConnection: IImapConnection,
	messageService: Pick<IMessageRepository, "get">,
	sourceMessageId: string,
	destinationMailboxPath: string,
): Promise<number | null> => {
	const [sourceMessage] = await messageService.get([sourceMessageId]);
	if (!sourceMessage?.messageIdHeader) return null;
	return searchMailboxByMessageId(
		rawConnection,
		destinationMailboxPath,
		sourceMessage.messageIdHeader,
	);
};

/**
 * Handle MESSAGE_COPY events.
 * Executes IMAP COPY command and updates local state with new UID.
 */
export const handleMessageCopy = async (
	event: MessageCopyEvent,
	log: Logger,
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
					// Open source mailbox (read-only is fine for COPY)
					await connection.openBox(sourceMailboxPath, true);

					// Execute IMAP COPY
					const result = await connection.copyMessages(
						[uid],
						destinationMailboxPath,
					);

					// Get new UID from COPYUID response. UIDPLUS is an extension: a
					// server without it answers a perfectly successful COPY with no
					// COPYUID entry, so an absent entry is UNCONFIRMED, never evidence
					// the copy failed. The destination is probed by Message-ID before
					// any verdict, exactly as `handleMessageMove` does (issue #1097; the
					// same shape #979 took out of `message-delete`). Marking the row
					// `failed` and returning — the old behaviour — left it `uid: 0`,
					// `status: moving`, `syncStatus: failed` permanently, with no retry,
					// no DLQ entry and no metric, because a handler that returns never
					// redelivers.
					const newUid =
						result.uidMap.get(uid) ??
						(await probeDestinationByMessageId(
							rawConnection,
							messageService,
							sourceMessageId,
							destinationMailboxPath,
						));

					if (newUid) {
						// Update the new message with the actual UID
						await messageService.updateUid(
							newMessageId,
							newUid,
							destinationMailboxId,
						);

						// Update message status to active
						await messageService.update(newMessageId, {
							status: MessageStatus.active,
							syncStatus: MessageSyncStatus.synced,
						});

						// Update ThreadMessage UID
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
					} else {
						// No COPYUID entry and no probe match: the copy is UNCONFIRMED,
						// not proven failed. Throw so the event redelivers — the generic
						// catch below marks the row `failed` as the unsettled marker
						// while the retry is pending. Wording must avoid "not found" and
						// "NONEXISTENT", which that catch reads as a server-side delete.
						throw new Error(
							`Message copy unconfirmed (no COPYUID entry, no match by Message-ID at ${destinationMailboxPath}) — retrying`,
						);
					}
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
						// Re-throw to let the event be retried
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

					// Mark as failed for other errors
					await messageService.update(newMessageId, {
						syncStatus: MessageSyncStatus.failed,
					});
					throw error;
				})
				.finally(() => scope.disconnect());
		},
	);
};
