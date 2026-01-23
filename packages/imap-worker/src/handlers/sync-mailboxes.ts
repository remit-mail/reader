import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { AccountService } from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/remit-logger-lambda";
import {
	createImapConnectionFromAccount,
	MailboxSyncService,
} from "@remit/mailbox-service";
import { expectEnv } from "expect-env";
import type { SyncMailboxesEvent } from "../events.js";

const tableName = expectEnv("DYNAMODB_TABLE_NAME");
const client = new DynamoDBClient({});

const accountService = new AccountService({ client, table: tableName });
const mailboxSyncService = new MailboxSyncService({ client, table: tableName });

export const syncMailboxes = async (
	event: SyncMailboxesEvent,
	log: Logger,
): Promise<void> => {
	log.info({ accountId: event.accountId }, "Syncing mailboxes");

	const account = await accountService.get(event.accountId);
	if (!account) {
		throw new Error(`Account ${event.accountId} not found`);
	}

	// TODO: Decrypt password using remit-secrets-service
	const connection = await createImapConnectionFromAccount({
		username: account.email,
		password: account.password || "", // Assuming plaintext for now as per RFC note
		host: account.imapHost,
		port: account.imapPort,
		tls: account.imapTls,
	});

	try {
		await connection.connect();
		const result = await mailboxSyncService.syncMailboxes(
			{ accountId: event.accountId },
			connection,
		);
		log.info({ result }, "Mailbox sync complete");
	} finally {
		await connection.end();
	}
};
