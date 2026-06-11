import {
	type AccountItem,
	AccountService,
	AddressService,
	EnvelopeService,
	getClient,
	MailboxLockService,
	MailboxService,
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import { SyncPhase } from "@remit/domain-enums";
import type { Logger } from "@remit/logger-lambda";
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

const BODY_BATCH_SIZE = 50;
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
			try {
				await syncMailboxMessages(event, account, log);
			} catch (err) {
				// Record the terminal error phase before crashing (let-it-crash:
				// record state, then rethrow so the event is retried/DLQ'd).
				const message = err instanceof Error ? err.message : String(err);
				await accountService.update(event.accountId, {
					syncPhase: SyncPhase.error,
					lastError: message,
				});
				throw err;
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

/**
 * Sync one batch of messages for a mailbox. Runs under the mailbox lock.
 */
const syncMailboxMessages = async (
	event: SyncMessagesEvent,
	account: AccountItem,
	log: Logger,
): Promise<void> => {
	const password = await secrets.decrypt(
		deserializeEncryptedPayload(JSON.parse(account.passwordHash)),
	);

	// Create a managed connection factory that caches and reuses the connection
	const connectionFactory = createManagedConnectionFactory({
		user: account.username,
		credentials: { kind: "password", password },
		host: account.imapHost,
		port: account.imapPort,
		tls: account.imapTls,
	});

	// Get the mailbox - it must exist (should have been created by mailbox sync)
	const mailbox = await mailboxService.get(event.mailboxId);
	const mailboxId = mailbox.mailboxId;
	const isInbox = mailbox.fullPath.toUpperCase() === "INBOX";

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
		for (let i = 0; i < result.syncedMessageIds.length; i += BODY_BATCH_SIZE) {
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
				const bodyEvent: Omit<SyncMessageBodyEvent, "eventId" | "timestamp"> = {
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

		const nextSyncEvent: Omit<SyncMessagesEvent, "eventId" | "timestamp"> = {
			type: "SYNC_MESSAGES",
			accountId: event.accountId,
			mailboxId,
		};
		await emitEvent(nextSyncEvent);
		return;
	}

	// Mailbox drained. Record the per-mailbox completion marker (used by the
	// sync-status endpoint to derive the per-mailbox phase), and count it
	// towards mailboxCountSynced — but only once per sync round, so that
	// duplicate / no-op SYNC_MESSAGES completions don't inflate the counter.
	// The check-then-write is safe: the mailbox lock serializes completions
	// per mailbox, and `mailbox` was read under the lock.
	const roundStartedAt = account.lastSyncAt ?? 0;
	const previousCompletedAt = mailbox.initialSyncCompletedAt ?? 0;
	const firstCompletionThisRound =
		previousCompletedAt === 0 || previousCompletedAt < roundStartedAt;

	await mailboxService.update(mailboxId, {
		initialSyncCompletedAt: Date.now(),
	});

	if (!firstCompletionThisRound) {
		log.info(
			{ mailboxId },
			"Mailbox already counted as synced this round, skipping increment",
		);
		return;
	}

	const currentAccount = await accountService.get(event.accountId);

	if (isInbox && currentAccount.syncPhase === SyncPhase.syncing_inbox) {
		// INBOX is drained; advance to syncing_others
		await accountService.update(event.accountId, {
			syncPhase: SyncPhase.syncing_others,
		});
	}

	// Atomically increment mailboxCountSynced; transitions to complete when all done
	await accountService.incrementMailboxSynced(event.accountId);
};
