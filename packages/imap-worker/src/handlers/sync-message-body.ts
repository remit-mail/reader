import {
	AccountService,
	getClient,
	MailboxService,
	MessageService,
} from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/remit-logger-lambda";
import type { IImapConnection } from "@remit/mailbox-service";
import {
	createKmsDataKeyProvider,
	createSecretsService,
	deserializeEncryptedPayload,
} from "@remit/secrets-service";
import {
	createStorageService,
	type StorageService,
} from "@remit/storage-service";
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

const fetchAndStoreBody = async (
	messageId: string,
	mailboxPath: string,
	getConnection: () => Promise<IImapConnection>,
	storage: StorageService,
	log: Logger,
): Promise<string | null> => {
	const message = await messageService.get(messageId);

	if (message.bodyStorageKey) {
		log.debug({ messageId }, "Body already stored, skipping");
		return null;
	}

	const connection = await getConnection();

	await connection.openBox(mailboxPath);
	const body = await connection.fetchMessageBody(message.uid);
	const ref = await storage.store(body, {
		key: `messages/${message.mailboxId}/${messageId}/body.eml`,
		contentType: "message/rfc822",
		contentAddressable: true,
	});

	await messageService.update(messageId, { bodyStorageKey: ref.uri });
	log.info({ messageId, storageKey: ref.uri }, "Body stored");
	return ref.uri;
};

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

	const processMessages = async () => {
		const results = await Promise.all(
			messageIds.map((messageId) =>
				fetchAndStoreBody(
					messageId,
					mailbox.fullPath,
					scope.getConnection,
					storage,
					log,
				).catch((error) => {
					log.error({ messageId, error }, "Failed to fetch body");
					return null;
				}),
			),
		);

		const stored = results.filter((r) => r !== null).length;
		log.info(
			{ stored, total: messageIds.length },
			"Message body sync complete",
		);
	};

	await processMessages().finally(() => scope.disconnect());
};
