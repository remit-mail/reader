import {
	AccountService,
	getClient,
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/remit-logger-lambda";
import {
	createKmsDataKeyProvider,
	createSecretsService,
	deserializeEncryptedPayload,
} from "@remit/secrets-service";
import { env } from "expect-env";
import { createConnectionScopeFromAccount } from "../connection-scope.js";
import type { EmptyTrashEvent } from "../events.js";

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
 * Handle EMPTY_TRASH events.
 * Permanently deletes all messages in the Trash mailbox.
 */
export const handleEmptyTrash = async (
	event: EmptyTrashEvent,
	log: Logger,
): Promise<void> => {
	const { accountId, trashMailboxId, trashMailboxPath } = event;

	log.info({ accountId, trashMailboxPath }, "Emptying trash on IMAP");

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
			await connection.openBox(trashMailboxPath, false);

			// Search for all messages in Trash
			const uids = await connection.search(["ALL"]);

			if (uids.length > 0) {
				// Delete all messages on IMAP
				await connection.deleteMessages(uids);
				log.info({ count: uids.length }, "Deleted messages from IMAP trash");
			}

			// Delete all local messages in trash
			const localMessages =
				await messageService.listAllByMailbox(trashMailboxId);

			for (const message of localMessages) {
				// Delete the Message entity
				await messageService.delete(message.messageId);

				// Delete the ThreadMessage entity
				const threadMessage = await threadMessageService.findByMessageId(
					message.messageId,
				);
				if (threadMessage) {
					await threadMessageService.delete(
						threadMessage.accountConfigId,
						threadMessage.threadMessageId,
					);
				}
			}

			log.info(
				{ accountId, deletedCount: localMessages.length },
				"Trash emptied successfully",
			);
		})
		.finally(() => scope.disconnect());
};
