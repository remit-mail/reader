import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { AccountService } from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/logger-lambda";
import {
	createImapConnectionFromAccount,
	MailboxSyncService,
} from "@remit/mailbox-service";
import {
	createKmsDataKeyProvider,
	createSecretsService,
} from "@remit/secrets-service";
import { env } from "expect-env";
import type { SyncMailboxesEvent } from "../events.js";

const client = new DynamoDBClient({});
const dataKeyProvider = createKmsDataKeyProvider(env.KMS_KEY_ID);
const secrets = createSecretsService(dataKeyProvider);

const accountService = new AccountService({ client, table: env.DYNAMODB_TABLE_NAME });
const mailboxSyncService = new MailboxSyncService({ client, table: env.DYNAMODB_TABLE_NAME });

export const syncMailboxes = async (
	event: SyncMailboxesEvent,
	log: Logger,
): Promise<void> => {
	log.info({ accountId: event.accountId }, "Syncing mailboxes");

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

	try {
		await connection.connect();
		const result = await mailboxSyncService.syncMailboxes(
			{ accountId: event.accountId },
			connection,
		);
		log.info({ result }, "Mailbox sync complete");
	} finally {
		await connection.disconnect();
	}
};
