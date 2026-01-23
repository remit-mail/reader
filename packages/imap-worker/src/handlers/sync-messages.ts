import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
	AccountService,
	AddressService,
	EnvelopeService,
	MailboxService,
	MessageService,
} from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/logger-lambda";
import {
	createImapConnectionFromAccount,
	MessageSyncService,
} from "@remit/mailbox-service";
import { expectEnv } from "expect-env";
import type { SyncMessagesEvent } from "../events.js";

const tableName = expectEnv("DYNAMODB_TABLE_NAME");
const client = new DynamoDBClient({});

const accountService = new AccountService({ client, table: tableName });
const mailboxService = new MailboxService({ client, table: tableName });
const messageService = new MessageService({ client, table: tableName });
const envelopeService = new EnvelopeService({ client, table: tableName });
const addressService = new AddressService({ client, table: tableName });

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

	// TODO: Decrypt password using remit-secrets-service
	const connection = await createImapConnectionFromAccount({
		username: account.email,
		password: account.password || "",
		host: account.imapHost,
		port: account.imapPort,
		tls: account.imapTls,
	});

	try {
		await connection.connect();

		const syncService = new MessageSyncService(
			connection,
			mailboxService,
			messageService,
			envelopeService,
			addressService,
		);

		const count = await syncService.syncMessages(
			event.mailboxId,
			event.accountId,
		);

		log.info({ count }, "Message sync complete");
	} finally {
		await connection.end();
	}
};
