import {
	AccountService,
	getClient,
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import { MessageSyncStatus } from "@remit/domain-enums";
import type { Logger } from "@remit/remit-logger-lambda";
import {
	createKmsDataKeyProvider,
	createSecretsService,
	deserializeEncryptedPayload,
} from "@remit/secrets-service";
import { env } from "expect-env";
import { isAccountDeleted } from "../account-check.js";
import { createConnectionScopeFromAccount } from "../connection-scope.js";
import type { MessageDeleteEvent } from "../events.js";

const client = getClient();
const dataKeyProvider = createKmsDataKeyProvider(env.KMS_KEY_ID);
const secrets = createSecretsService(dataKeyProvider);

const accountService = new AccountService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});
const messageService = new MessageService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});
const threadMessageService = new ThreadMessageService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});

/**
 * Handle MESSAGE_DELETE events.
 * Either moves to Trash (IMAP MOVE) or permanently deletes (IMAP DELETE).
 */
export const handleMessageDelete = async (
	event: MessageDeleteEvent,
	log: Logger,
): Promise<void> => {
	const {
		accountId,
		messageId,
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

	const password = await secrets.decrypt(
		deserializeEncryptedPayload(JSON.parse(account.passwordHash)),
	);

	const scope = createConnectionScopeFromAccount(account, password);

	await scope
		.getConnection()
		.then(async (connection) => {
			await connection.openBox(mailboxPath, false);

			if (operation === "move_to_trash" && destinationMailboxPath) {
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
					const threadMessage =
						await threadMessageService.findByMessageId(messageId);
					if (threadMessage) {
						await threadMessageService.update(
							threadMessage.accountConfigId,
							threadMessage.threadMessageId,
							{
								uid: newUid,
								mailboxId: destinationMailboxId,
								isDeleted: true,
							},
							{
								composites: {
									sentDate: threadMessage.sentDate,
									mailboxId: destinationMailboxId,
									isRead: threadMessage.isRead,
									isDeleted: true,
									hasStars: threadMessage.hasStars,
									hasAttachment: threadMessage.hasAttachment,
								},
							},
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
				// Permanent delete
				await connection.deleteMessages([uid]);

				// Delete local Message entity
				await messageService.delete(messageId);

				// Delete ThreadMessage entity (cleanup)
				const threadMessage =
					await threadMessageService.findByMessageId(messageId);
				if (threadMessage) {
					await threadMessageService.delete(
						threadMessage.accountConfigId,
						threadMessage.threadMessageId,
					);
				}

				log.info({ messageId }, "Message permanently deleted");
			}
		})
		.catch(async (error: unknown) => {
			const errorMessage =
				error instanceof Error ? error.message : String(error);

			// Message not found on IMAP - already deleted (idempotent)
			if (
				errorMessage.includes("not found") ||
				errorMessage.includes("NONEXISTENT")
			) {
				log.info(
					{ messageId, uid },
					"Message not found on IMAP, cleaning up local",
				);
				// Clean up local entities
				await messageService.delete(messageId);
				const threadMessage =
					await threadMessageService.findByMessageId(messageId);
				if (threadMessage) {
					await threadMessageService.delete(
						threadMessage.accountConfigId,
						threadMessage.threadMessageId,
					);
				}
				return;
			}

			// TRYCREATE - Trash doesn't exist
			if (errorMessage.includes("TRYCREATE") && destinationMailboxPath) {
				log.info(
					{ destinationMailboxPath },
					"Trash mailbox doesn't exist, creating",
				);
				const connection = await scope.getConnection();
				await connection.createMailbox(destinationMailboxPath);
				// Re-throw to let the event be retried
				throw error;
			}

			// Mark as failed for other errors
			await messageService.update(messageId, {
				syncStatus: MessageSyncStatus.failed,
			});
			throw error;
		})
		.finally(() => scope.disconnect());
};
