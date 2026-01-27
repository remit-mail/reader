import {
	AccountService,
	getClient,
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import type { Logger } from "@remit/logger-lambda";
import {
	createKmsDataKeyProvider,
	createSecretsService,
	deserializeEncryptedPayload,
} from "@remit/secrets-service";
import { env } from "expect-env";
import { createConnectionScopeFromAccount } from "../connection-scope.js";
import type { MessageMoveEvent } from "../events.js";

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
 * Handle MESSAGE_MOVE events.
 * Executes IMAP MOVE command and updates local state with new UID.
 */
export const handleMessageMove = async (
	event: MessageMoveEvent,
	log: Logger,
): Promise<void> => {
	const {
		accountId,
		messageId,
		sourceMailboxPath,
		destinationMailboxPath,
		destinationMailboxId,
		uid,
	} = event;

	log.info(
		{
			accountId,
			messageId,
			from: sourceMailboxPath,
			to: destinationMailboxPath,
		},
		"Moving message on IMAP",
	);

	const account = await accountService.get(accountId);
	if (!account) {
		throw new Error(`Account ${accountId} not found`);
	}

	const password = await secrets.decrypt(
		deserializeEncryptedPayload(JSON.parse(account.passwordHash)),
	);

	const scope = createConnectionScopeFromAccount(account, password);

	await scope
		.getConnection()
		.then(async (connection) => {
			// Open source mailbox (not read-only)
			await connection.openBox(sourceMailboxPath, false);

			// Execute IMAP MOVE
			const result = await connection.moveMessages(
				[uid],
				destinationMailboxPath,
			);

			// Get new UID from COPYUID response
			const newUid = result.uidMap.get(uid);

			if (newUid) {
				// Update message with new UID
				await messageService.updateUid(messageId, newUid, destinationMailboxId);

				// Update ThreadMessage UID and mailboxId
				const threadMessage =
					await threadMessageService.findByMessageId(messageId);
				if (threadMessage) {
					await threadMessageService.update(
						threadMessage.accountConfigId,
						threadMessage.threadMessageId,
						{ uid: newUid, mailboxId: destinationMailboxId, isDeleted: false },
						{
							composites: {
								sentDate: threadMessage.sentDate,
								mailboxId: destinationMailboxId,
								isRead: threadMessage.isRead,
								isDeleted: false,
								hasStars: threadMessage.hasStars,
								hasAttachment: threadMessage.hasAttachment,
							},
						},
					);
				}

				log.info(
					{
						messageId,
						oldUid: uid,
						newUid,
						destination: destinationMailboxPath,
					},
					"Message moved successfully",
				);
			} else {
				// Message may have been deleted on server
				log.error(
					{ messageId, uid },
					"Message not found in COPYUID response - may have been deleted",
				);
				await messageService.update(messageId, {
					syncStatus: MessageSyncStatus.failed,
				});
			}
		})
		.catch(async (error: unknown) => {
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

			// Handle message not found on IMAP - already moved/deleted (idempotent)
			if (
				errorMessage.includes("not found") ||
				errorMessage.includes("NONEXISTENT")
			) {
				log.info(
					{ messageId, uid },
					"Message not found on IMAP, updating local state as synced",
				);
				await messageService.update(messageId, {
					status: MessageStatus.active,
					syncStatus: MessageSyncStatus.synced,
				});
				return;
			}

			// Mark as failed for other errors
			await messageService.update(messageId, {
				syncStatus: MessageSyncStatus.failed,
			});
			throw error;
		})
		.finally(() => scope.disconnect());
};
