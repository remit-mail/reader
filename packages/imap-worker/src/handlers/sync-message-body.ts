import {
	AccountService,
	getClient,
	MailboxService,
	MessageService,
} from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/remit-logger-lambda";
import { BodySyncService } from "@remit/mailbox-service";
import {
	createKmsDataKeyProvider,
	createSecretsService,
	deserializeEncryptedPayload,
} from "@remit/secrets-service";
import { createStorageService } from "@remit/storage-service";
import { env } from "expect-env";
import { createConnectionScopeFromAccount } from "../connection-scope.js";
import type { SyncMessageBodyEvent } from "../events.js";

const client = getClient();
const dataKeyProvider = createKmsDataKeyProvider(env.KMS_KEY_ID);
const secrets = createSecretsService(dataKeyProvider);

const accountService = new AccountService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});
const mailboxService = new MailboxService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});
const messageService = new MessageService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});

export const syncMessageBody = async (
	event: SyncMessageBodyEvent,
	log: Logger,
): Promise<void> => {
	const { accountId, mailboxId, messageIds } = event;

	log.info(
		{ accountId, mailboxId, messageCount: messageIds.length },
		"Syncing message bodies",
	);

	const account = await accountService.get(accountId);
	if (!account) {
		throw new Error(`Account ${accountId} not found`);
	}

	const password = await secrets.decrypt(
		deserializeEncryptedPayload(JSON.parse(account.passwordHash)),
	);

	const scope = createConnectionScopeFromAccount(account, password);
	const mailbox = await mailboxService.get(mailboxId);
	const storage = createStorageService();

	const bodySyncService = new BodySyncService(messageService, storage, log);

	await bodySyncService
		.syncBodies(messageIds, mailbox.fullPath, scope.getConnection)
		.finally(() => scope.disconnect());
};
