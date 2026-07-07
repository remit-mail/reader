import {
	AccountService,
	getClient,
	MessageService,
	type ThreadMessageItem,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import { MessageSyncStatus } from "@remit/domain-enums";
import type { Logger } from "@remit/remit-logger-lambda";
import {
	createKmsDataKeyProvider,
	createSecretsService,
} from "@remit/secrets-service";
import { env } from "expect-env";
import { isAccountDeleted } from "../account-check.js";
import { createConnectionScopeWithCredentials } from "../connection-scope.js";
import type { MessageDeleteEvent } from "../events.js";
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
		ThreadMessageService,
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
export const buildThreadMessageTrashUpdate = (
	threadMessage: Pick<
		ThreadMessageItem,
		| "sentDate"
		| "mailboxId"
		| "isRead"
		| "isDeleted"
		| "hasStars"
		| "hasAttachment"
	>,
	newUid: number,
	destinationMailboxId: string,
) => ({
	set: {
		uid: newUid,
		mailboxId: destinationMailboxId,
		isDeleted: true,
	},
	composites: {
		sentDate: threadMessage.sentDate,
		mailboxId: threadMessage.mailboxId,
		isRead: threadMessage.isRead,
		isDeleted: threadMessage.isDeleted,
		hasStars: threadMessage.hasStars,
		hasAttachment: threadMessage.hasAttachment,
	},
});

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

	await withOAuthLifecycle(
		buildLifecycleDeps(secrets, accountService),
		account,
		log,
		async (credentials) => {
			const scope = createConnectionScopeWithCredentials(account, credentials);

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
						// Permanent delete
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
		},
	);
};
