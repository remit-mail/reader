import {
	AccountService,
	getClient,
	MailboxService,
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/logger-lambda";
import { BodySyncService } from "@remit/mailbox-service";
import {
	createKmsDataKeyProvider,
	createSecretsService,
	deserializeEncryptedPayload,
} from "@remit/secrets-service";
import { createStorageService } from "@remit/storage-service";
import { env } from "expect-env";
import { isAccountDeleted } from "../account-check.js";
import { createConnectionScopeFromAccount } from "../connection-scope.js";
import { emitEvent } from "../emit.js";
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
const threadMessageService = new ThreadMessageService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});

export const syncMessageBody = async (
	event: SyncMessageBodyEvent,
	log: Logger,
): Promise<void> => {
	const { accountId, mailboxId, messageIds } = event;

	log.info(
		{
			event: event.type,
			accountId,
			mailboxId,
			messageCount: messageIds.length,
		},
		"Handling event",
	);

	const account = await accountService.get(accountId);
	if (!account) {
		throw new Error(`Account ${accountId} not found`);
	}

	if (isAccountDeleted(account, log)) {
		return;
	}

	const password = await secrets.decrypt(
		deserializeEncryptedPayload(JSON.parse(account.passwordHash)),
	);

	const scope = createConnectionScopeFromAccount(account, password);
	const mailbox = await mailboxService.get(mailboxId);
	const storage = createStorageService();

	const bodySyncService = new BodySyncService(
		messageService,
		storage,
		threadMessageService,
		log,
	);

	const result = await bodySyncService
		.syncBodies(
			messageIds,
			accountId,
			account.accountConfigId,
			mailbox.fullPath,
			scope.getConnection,
		)
		.finally(() => scope.disconnect());

	// Re-enqueue failed messages for retry with jittered delay to avoid thundering herd
	if (result.failedMessageIds.length > 0) {
		const retryDelaySeconds = 20 + Math.floor(Math.random() * 21); // 20-40 seconds
		log.info(
			{ failedCount: result.failedMessageIds.length, retryDelaySeconds },
			"Re-enqueueing failed body syncs with delay",
		);

		const retryEvent: Omit<SyncMessageBodyEvent, "eventId" | "timestamp"> = {
			type: "SYNC_MESSAGE_BODY",
			accountId,
			mailboxId,
			messageIds: result.failedMessageIds,
		};
		await emitEvent(retryEvent, { delaySeconds: retryDelaySeconds });
	}
};
