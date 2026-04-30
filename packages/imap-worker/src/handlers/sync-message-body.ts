import { SQSClient } from "@aws-sdk/client-sqs";
import { AwsQueryProtocol } from "@aws-sdk/core/protocols";
import {
	AccountService,
	AddressService,
	getClient,
	MailboxService,
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/remit-logger-lambda";
import { BodySyncService } from "@remit/mailbox-service";
import {
	enqueueSearchIndexEvents,
	type IndexEvent,
} from "@remit/search-index-worker";
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
const addressService = new AddressService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});

const searchIndexQueueUrl = process.env.SQS_QUEUE_URL_SEARCH_INDEX;
const isLocalSqs = searchIndexQueueUrl?.startsWith("http://localhost");
const searchIndexSqs = searchIndexQueueUrl
	? new SQSClient({
			endpoint: isLocalSqs ? new URL(searchIndexQueueUrl).origin : undefined,
			...(isLocalSqs && { protocol: AwsQueryProtocol }),
		})
	: undefined;

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
		addressService,
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

	// Enqueue search index upsert events for successfully synced messages (best-effort).
	if (
		result.syncedMessageIds.length > 0 &&
		searchIndexSqs &&
		searchIndexQueueUrl
	) {
		const events: IndexEvent[] = result.syncedMessageIds.map((messageId) => ({
			type: "upsert" as const,
			messageId,
			accountId,
			accountConfigId: account.accountConfigId,
			mailboxIds: [mailboxId],
		}));
		await enqueueSearchIndexEvents(
			searchIndexSqs,
			searchIndexQueueUrl,
			events,
		).catch((error: unknown) => {
			log.warn(
				{ error: (error as Error).message },
				"Failed to enqueue search index events (best-effort)",
			);
		});
	}

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
