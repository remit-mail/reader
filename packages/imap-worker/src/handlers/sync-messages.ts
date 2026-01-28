import {
	AccountService,
	AddressService,
	EnvelopeService,
	getClient,
	MailboxLockService,
	MailboxService,
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/remit-logger-lambda";
import {
	createManagedConnectionFactory,
	MessageSyncService,
} from "@remit/mailbox-service";
import {
	createKmsDataKeyProvider,
	createSecretsService,
	deserializeEncryptedPayload,
} from "@remit/secrets-service";
import { env } from "expect-env";
import pMap from "p-map";
import { isAccountDeleted } from "../account-check.js";
import { emitEvent } from "../emit.js";
import type { SyncMessageBodyEvent, SyncMessagesEvent } from "../events.js";

const BODY_BATCH_SIZE = 25;
const EVENT_EMIT_CONCURRENCY = 10;
const MESSAGE_BATCH_SIZE = 200;

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
const threadMessageService = new ThreadMessageService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});
const mailboxLockService = new MailboxLockService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});

export const syncMessages = async (
	event: SyncMessagesEvent,
	log: Logger,
): Promise<void> => {
	log.info(
		{
			event: event.type,
			accountId: event.accountId,
			mailboxId: event.mailboxId,
		},
		"Handling event",
	);

	const account = await accountService.get(event.accountId);
	if (!account) {
		throw new Error(`Account ${event.accountId} not found`);
	}

	if (isAccountDeleted(account, log)) {
		return;
	}

	// Acquire lock before starting sync operation
	const { executed } = await mailboxLockService.withMailboxLock(
		event.mailboxId,
		"SYNC_MESSAGES",
		event.accountId,
		async () => {
			const password = await secrets.decrypt(
				deserializeEncryptedPayload(JSON.parse(account.passwordHash)),
			);

			// Create a managed connection factory that caches and reuses the connection
			const connectionFactory = createManagedConnectionFactory({
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
				threadMessageService,
				log,
			);

			// Connect once, reuse for the entire sync operation
			const connection = connectionFactory.getConnection();
			await connection.connect();

			const result = await syncService
				.syncMessages(mailboxId, account.accountConfigId, MESSAGE_BATCH_SIZE)
				.finally(() => connectionFactory.close());
			log.info(
				{
					syncedCount: result.syncedCount,
					hasMore: result.hasMore,
					remainingCount: result.remainingCount,
				},
				"Message sync batch complete",
			);

			// Emit body sync events for the messages we just synced
			if (result.syncedMessageIds.length > 0) {
				// Create batches
				const batches: string[][] = [];
				for (
					let i = 0;
					i < result.syncedMessageIds.length;
					i += BODY_BATCH_SIZE
				) {
					batches.push(result.syncedMessageIds.slice(i, i + BODY_BATCH_SIZE));
				}

				log.info(
					{ count: result.syncedMessageIds.length, batches: batches.length },
					"Emitting SYNC_MESSAGE_BODY events",
				);

				// Emit events in parallel with concurrency limit
				await pMap(
					batches,
					(batch) => {
						const bodyEvent: Omit<
							SyncMessageBodyEvent,
							"eventId" | "timestamp"
						> = {
							type: "SYNC_MESSAGE_BODY",
							accountId: event.accountId,
							mailboxId,
							messageIds: batch,
						};
						return emitEvent(bodyEvent);
					},
					{ concurrency: EVENT_EMIT_CONCURRENCY },
				);
			}

			// If there are more messages to sync, emit another SYNC_MESSAGES event
			if (result.hasMore) {
				log.info(
					{ remainingCount: result.remainingCount },
					"Emitting SYNC_MESSAGES event for next batch",
				);

				const nextSyncEvent: Omit<SyncMessagesEvent, "eventId" | "timestamp"> =
					{
						type: "SYNC_MESSAGES",
						accountId: event.accountId,
						mailboxId,
					};
				await emitEvent(nextSyncEvent);
			}
		},
	);

	if (!executed) {
		log.info(
			{ mailboxId: event.mailboxId },
			"Sync already in progress, skipping",
		);
	}
};
