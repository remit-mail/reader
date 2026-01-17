import {
	AccountService,
	getClient,
	MailboxService,
	MessageService,
} from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/logger-lambda";
import {
	createKmsDataKeyProvider,
	createSecretsService,
	deserializeEncryptedPayload,
} from "@remit/secrets-service";
import { createStorageService } from "@remit/storage-service";
import { env } from "expect-env";
import { createConnectionScopeFromAccount } from "../connection-scope.js";
import type { FetchBodyEvent } from "../events.js";

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

export const fetchBody = async (
	event: FetchBodyEvent,
	log: Logger,
): Promise<void> => {
	const { accountId, mailboxId, messageId } = event;

	log.info({ accountId, mailboxId, messageId }, "Fetching message body");

	const message = await messageService.get(messageId);

	if (message.bodyStorageKey) {
		log.info(
			{ messageId, storageKey: message.bodyStorageKey },
			"Body already stored",
		);
		return;
	}

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

	const fetchAndStore = async () => {
		const connection = await scope.getConnection();
		await connection.openBox(mailbox.fullPath);
		const body = await connection.fetchMessageBody(message.uid);
		const ref = await storage.store(body, {
			key: `messages/${mailboxId}/${messageId}/body.eml`,
			contentType: "message/rfc822",
			contentAddressable: true,
		});
		await messageService.update(messageId, { bodyStorageKey: ref.uri });
		return ref.uri;
	};

	const storageKey = await fetchAndStore().finally(() => scope.disconnect());

	log.info({ messageId, storageKey }, "Body fetched and stored");
};
