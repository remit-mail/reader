import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
	AccountService,
	AddressService,
	EnvelopeService,
	MailboxService,
	MessageService,
} from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/remit-logger-lambda";
import {
	createImapConnectionFromAccount,
	MessageSyncService,
} from "@remit/mailbox-service";
import {
	createKmsDataKeyProvider,
	createSecretsService,
} from "@remit/secrets-service";
import { env } from "expect-env";
import type { SyncMessagesEvent } from "../events.js";

const client = new DynamoDBClient({});
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
const envelopeService = new EnvelopeService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});
const addressService = new AddressService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});

export const syncMessages = async (
	event: SyncMessagesEvent,
	log: Logger,
): Promise<void> => {
	log.info(
		{ accountId: event.accountId, mailboxId: event.mailboxId },
		"Syncing messages",
	);

	const account = await accountService.get(event.accountId);
	if (!account) {
		throw new Error(`Account ${event.accountId} not found`);
	}

	const password = await secrets.decrypt(JSON.parse(account.passwordHash));
	const connection = createImapConnectionFromAccount(
		{
			username: account.email,
			imapHost: account.imapHost,
			imapPort: account.imapPort,
			imapTls: account.imapTls,
		},
		password,
	);

	await connection.connect();

	const syncService = new MessageSyncService(
		connection,
		mailboxService,
		messageService,
		envelopeService,
		addressService,
	);

	await syncService
		.syncMessages(event.mailboxId, event.accountId)
		.then((count) => log.info({ count }, "Message sync complete"))
		.catch((error) => {
			log.error({ error }, "Message sync failed");
			throw error;
		})
		.finally(() => connection.disconnect());
};
