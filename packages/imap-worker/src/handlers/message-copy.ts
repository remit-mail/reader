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
} from "@remit/secrets-service";
import { env } from "expect-env";
import { isAccountDeleted } from "../account-check.js";
import { createConnectionScopeWithCredentials } from "../connection-scope.js";
import type { MessageCopyEvent } from "../events.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";

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
 * Handle MESSAGE_COPY events.
 * Executes IMAP COPY command and updates local state with new UID.
 */
export const handleMessageCopy = async (
	event: MessageCopyEvent,
	log: Logger,
): Promise<void> => {
	const {
		accountId,
		sourceMessageId,
		newMessageId,
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
			const scope = createConnectionScopeWithCredentials(account, credentials);

			await scope
				.getConnection()
				.then(async (connection) => {
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
