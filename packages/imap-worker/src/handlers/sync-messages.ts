import {
	AccountService,
	AddressService,
	EnvelopeService,
	getClient,
	MailboxService,
	MessageService,
} from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/logger-lambda";
import {
	createConnection,
	MessageSyncService,
} from "@remit/mailbox-service";
import {
	createKmsDataKeyProvider,
	createSecretsService,
	deserializeEncryptedPayload,
} from "@remit/secrets-service";
import { env } from "expect-env";
import { emitEvent } from "../emit.js";
import type { SyncMessageBodyEvent, SyncMessagesEvent } from "../events.js";

const BODY_BATCH_SIZE = 10;

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

	const password = await secrets.decrypt(
		deserializeEncryptedPayload(JSON.parse(account.passwordHash)),
	);

	// Create a connection factory that returns fresh connections
	const connectionFactory = () =>
		createConnection({
			user: account.username,
			password,
			host: account.imapHost,
			port: account.imapPort,
			tls: account.imapTls,
		});

	// Get the mailbox - it must exist (should have been created by mailbox sync)
	const mailbox = await mailboxService.get(event.mailboxId);
	const mailboxId = mailbox.mailboxId;

	const syncService = new MessageSyncService(
		connectionFactory,
		mailboxService,
		messageService,
		envelopeService,
		addressService,
		log,
	);

	const count = await syncService.syncMessages(
		mailboxId,
		account.accountConfigId,
	);
	log.info({ count }, "Message sync complete");

	if (count === 0) {
		return;
	}

	const messagesWithoutBody = await collectMessagesWithoutBody(
		mailboxId,
		messageService,
	);

	if (messagesWithoutBody.length === 0) {
		log.info("No messages need body fetching");
		return;
	}

	log.info(
		{ count: messagesWithoutBody.length },
		"Emitting SYNC_MESSAGE_BODY events",
	);

	for (let i = 0; i < messagesWithoutBody.length; i += BODY_BATCH_SIZE) {
		const batch = messagesWithoutBody.slice(i, i + BODY_BATCH_SIZE);
		const bodyEvent: Omit<SyncMessageBodyEvent, "eventId" | "timestamp"> = {
			type: "SYNC_MESSAGE_BODY",
			accountId: event.accountId,
			mailboxId,
			messageIds: batch,
		};
		await emitEvent(bodyEvent);
	}
};

const collectMessagesWithoutBody = async (
	mailboxId: string,
	messageService: MessageService,
): Promise<string[]> => {
	const messageIds: string[] = [];
	let continuationToken: string | undefined;

	do {
		const result = await messageService.listByMailbox(mailboxId, {
			limit: 100,
			continuationToken,
		});

		for (const message of result.items) {
			if (!message.bodyStorageKey) {
				messageIds.push(message.messageId);
			}
		}

		continuationToken = result.continuationToken ?? undefined;
	} while (continuationToken);

	return messageIds;
};
