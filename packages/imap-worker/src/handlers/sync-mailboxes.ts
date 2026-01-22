import { AccountService, getClient } from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/logger-lambda";
import {
	createConnectionFromAccount,
	MailboxSyncService,
} from "@remit/mailbox-service";
import {
	createKmsDataKeyProvider,
	createSecretsService,
	deserializeEncryptedPayload,
} from "@remit/secrets-service";
import { env } from "expect-env";
import type { SyncMailboxesEvent } from "../events.js";

const client = getClient();
const dataKeyProvider = createKmsDataKeyProvider(env.KMS_KEY_ID);
const secrets = createSecretsService(dataKeyProvider);

const accountService = new AccountService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});
const mailboxSyncService = new MailboxSyncService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});

export const syncMailboxes = async (
	event: SyncMailboxesEvent,
	log: Logger,
): Promise<void> => {
	log.info({ accountId: event.accountId }, "Syncing mailboxes");

	const account = await accountService.get(event.accountId);
	if (!account) {
		throw new Error(`Account ${event.accountId} not found`);
	}

	const password = await secrets.decrypt(
		deserializeEncryptedPayload(JSON.parse(account.passwordHash)),
	);

	const connection = createConnectionFromAccount(
		{
			username: account.username,
			imapHost: account.imapHost,
			imapPort: account.imapPort,
			imapTls: account.imapTls,
		},
		password,
	);

	await connection.connect();

	await mailboxSyncService
		.syncMailboxes({ accountId: event.accountId }, connection)
		.then((result) => log.info({ result }, "Mailbox sync complete"))
		.catch((error) => {
			log.error({ error }, "Mailbox sync failed");
			throw error;
		})
		.finally(() => connection.disconnect());
};
