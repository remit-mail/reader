import { getClient } from "@remit/backend/client";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import type { Logger } from "@remit/remit-logger-lambda";
import {
	guardConnectionCursor,
	isCursorRebuildNeeded,
	MailboxCursorPausedError,
} from "@remit/mailbox-service";
import { isAccountDeleted } from "../account-check.js";
import { createConnectionScopeWithCredentials } from "../connection-scope.js";
import type { MessageCopyEvent } from "../events.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";

/**
 * Handle MESSAGE_COPY events.
 * Executes IMAP COPY command and updates local state with new UID.
 */
export const handleMessageCopy = async (
	event: MessageCopyEvent,
	log: Logger,
): Promise<void> => {
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
			const mailbox = await mailboxService.get(accountId, sourceMailboxId);

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

					// Get new UID from COPYUID response
					const newUid = result.uidMap.get(uid);

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
						// Source message may have been deleted on server
						log.error(
							{ sourceMessageId, uid },
							"Source message not found in COPYUID response - may have been deleted",
						);
						await messageService.update(newMessageId, {
							syncStatus: MessageSyncStatus.failed,
						});
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
