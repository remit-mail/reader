import { getClient } from "@remit/backend/client";
import type {
	AccountItem,
	IAccountRepository,
	IAddressRepository,
	IEnvelopeRepository,
	IMailboxRepository,
	IMessageFlagPushRepository,
	IMessageRepository,
	IThreadMessageRepository,
	IUnitOfWork,
} from "@remit/data-ports";
import { SyncPhase } from "@remit/domain-enums";
import { type Logger, MetricUnit, metrics } from "@remit/logger-lambda";
import { RefreshTokenError } from "@remit/mail-oauth-service";
import {
	createManagedConnectionFactory,
	MailConnectionError,
	type MailCredentials,
	MessageSyncService,
	type SyncedMessage,
} from "@remit/mailbox-service";
import pMap from "p-map";
import { isAccountDeleted, isUnsyncableHost } from "../account-check.js";
import { emitEvent } from "../emit.js";
import type {
	FlagPushEvent,
	SyncMessageBodyEvent,
	SyncMessagesEvent,
} from "../events.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";

// One SYNC_MESSAGE_BODY event maps to one ranged UID FETCH on the consumer.
export const BODY_BATCH_SIZE = 200;
const EVENT_EMIT_CONCURRENCY = 10;
const MESSAGE_BATCH_SIZE = 200;

/** Slice synced messages into body-sync batches, each one ranged FETCH. */
export const batchSyncedMessages = (
	syncedMessages: SyncedMessage[],
	batchSize: number = BODY_BATCH_SIZE,
): SyncedMessage[][] => {
	const batches: SyncedMessage[][] = [];
	for (let i = 0; i < syncedMessages.length; i += batchSize) {
		batches.push(syncedMessages.slice(i, i + batchSize));
	}
	return batches;
};

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

	const {
		account: accountService,
		mailbox: mailboxService,
		message: messageService,
		envelope: envelopeService,
		address: addressService,
		threadMessage: threadMessageService,
		mailboxLock: mailboxLockService,
		flagPush: flagPushMarkerService,
		unitOfWork,
		secrets,
	} = await getClient();

	// A deleted account never has its DDB row purged in lockstep with the queued
	// SYNC_MESSAGES triggers, so a trigger can outlive its account. The lookup
	// then returns null (or throws a named NotFoundError), which can never succeed
	// on retry — it would retry to maxReceiveCount and poison the messages DLQ
	// forever (issue #911). Treat a missing account as terminal: ack the event
	// with a WARN. Genuinely transient failures (throttle, network) surface as
	// other errors and still propagate to be retried.
	let account: AccountItem;
	const rawAccount = await accountService.get(event.accountId).catch((err) => {
		if ((err as { name?: string })?.name === "NotFoundError") return null;
		throw err;
	});
	if (!rawAccount) {
		log.warn(
			{
				accountId: event.accountId,
				mailboxId: event.mailboxId,
				eventId: event.eventId,
			},
			"Skipping SYNC_MESSAGES: account no longer exists",
		);
		return;
	}
	account = rawAccount;

	if (isAccountDeleted(account, log)) {
		return;
	}

	// A reserved/never-resolvable IMAP host (RFC 2606) can never connect, so a
	// sync attempt would retry and dead-letter forever. Skip cleanly — ack the
	// event without connecting or throwing.
	if (isUnsyncableHost(account, log.child({ mailboxId: event.mailboxId }))) {
		return;
	}

	// withOAuthLifecycle owns the reauth/ACK contract (skip-if-reauth, resolve
	// credentials, flip on terminal auth failure, rethrow transient). The
	// mailbox lock and the actual sync run inside the wrapper callback.
	await withOAuthLifecycle(
		buildLifecycleDeps(secrets, accountService),
		account,
		log,
		async (credentials) => {
			// Acquire lock before starting sync operation
			const { executed } = await mailboxLockService.withMailboxLock(
				event.mailboxId,
				"SYNC_MESSAGES",
				event.accountId,
				async () => {
					try {
						await syncMailboxMessages(
							event,
							account,
							credentials,
							{
								accountService,
								mailboxService,
								messageService,
								envelopeService,
								addressService,
								threadMessageService,
								flagPushMarkerService,
								unitOfWork,
							},
							log,
						);
					} catch (err) {
						// Auth failures are handled by the wrapper — rethrow untouched.
						if (
							err instanceof RefreshTokenError ||
							(err instanceof MailConnectionError && err.kind === "auth")
						) {
							throw err;
						}
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
		},
	);
};

interface SyncDeps {
	accountService: IAccountRepository;
	mailboxService: IMailboxRepository;
	messageService: IMessageRepository;
	envelopeService: IEnvelopeRepository;
	addressService: IAddressRepository;
	threadMessageService: IThreadMessageRepository;
	flagPushMarkerService: IMessageFlagPushRepository;
	unitOfWork?: IUnitOfWork;
}

// Bounds concurrent SQS sends while re-arming stuck flag-push markers —
// markers are expected to be few, but never unbounded (coding-standards.md).
const FLAG_PUSH_DRAIN_CONCURRENCY = 5;

/**
 * Periodic per-mailbox drain point for pending flag-push markers (issue
 * #1273, epic #1281). The SQS enqueue in `FlagPushService.flip` is only a
 * wake-up hint and may fail freely — a marker left `state: "pending"` means
 * that hint never landed (queue down, or a crash between the local write and
 * the enqueue). This periodic tick — which already runs per mailbox on a
 * schedule regardless of user activity — re-arms every such marker with a
 * fresh `FLAG_PUSH` event, closing the gap without the caller ever having to
 * retry.
 *
 * Markers already `queued`/`processing` are left alone: a live SQS message
 * (or the single-marker handler currently running) already owns driving them
 * forward, and re-arming them too would just duplicate work.
 *
 * A re-arm failure (the SQS send itself) is caught per-marker and logged
 * loudly — it must never fail the surrounding SYNC_MESSAGES batch, which is
 * unrelated message-header sync work. The marker stays durable regardless;
 * the next periodic tick tries again.
 *
 * `emit` defaults to the real `emitEvent` (imap-worker's shared SQS
 * producer) and is only ever overridden in tests.
 */
export const drainPendingFlagPushes = async (
	flagPushMarkerService: IMessageFlagPushRepository,
	account: AccountItem,
	mailboxId: string,
	log: Logger,
	emit: typeof emitEvent = emitEvent,
): Promise<void> => {
	const markers = await flagPushMarkerService.listByMailboxId(mailboxId);
	const stuck = markers.filter((marker) => marker.state === "pending");
	if (stuck.length === 0) return;

	log.info(
		{ mailboxId, count: stuck.length },
		"Periodic sync tick found flag-push marker(s) stuck before their wake-up hint; re-arming",
	);

	await pMap(
		stuck,
		(marker) => {
			const rearmEvent: Omit<FlagPushEvent, "eventId" | "timestamp"> = {
				type: "FLAG_PUSH",
				accountId: account.accountId,
				accountConfigId: account.accountConfigId,
				messageId: marker.messageId,
				flagName: marker.flagName,
			};
			return emit(rearmEvent).catch((error: unknown) => {
				log.error(
					{
						alert: "flag_push_drain_rearm_failed",
						mailboxId,
						messageId: marker.messageId,
						flagName: marker.flagName,
						error: error instanceof Error ? error.message : String(error),
					},
					"Failed to re-arm a stuck pending flag-push marker during the periodic drain",
				);
			});
		},
		{ concurrency: FLAG_PUSH_DRAIN_CONCURRENCY },
	);
};

/**
 * Sync one batch of messages for a mailbox. Runs under the mailbox lock.
 */
const syncMailboxMessages = async (
	event: SyncMessagesEvent,
	account: AccountItem,
	credentials: MailCredentials,
	deps: SyncDeps,
	log: Logger,
): Promise<void> => {
	const {
		accountService,
		mailboxService,
		messageService,
		envelopeService,
		addressService,
		threadMessageService,
		flagPushMarkerService,
		unitOfWork,
	} = deps;

	// Create a managed connection factory that caches and reuses the connection
	const connectionFactory = createManagedConnectionFactory({
		user: account.username,
		credentials,
		host: account.imapHost,
		port: account.imapPort,
		tls: account.imapTls,
	});

	// Get the mailbox - it must exist (should have been created by mailbox sync)
	const mailbox = await mailboxService.get(account.accountId, event.mailboxId);
	const mailboxId = mailbox.mailboxId;

	// Periodic drain (issue #1273): independent of the IMAP sync below — no
	// connection needed, just an SQS re-arm — so it runs regardless of this
	// round's sync outcome.
	await drainPendingFlagPushes(flagPushMarkerService, account, mailboxId, log);
	const isInbox = mailbox.fullPath.toUpperCase() === "INBOX";

	const syncService = new MessageSyncService(
		connectionFactory,
		mailboxService,
		messageService,
		envelopeService,
		addressService,
		threadMessageService,
		log,
		unitOfWork,
	);

	// Connect once, reuse for the entire sync operation
	const connection = connectionFactory.getConnection();
	await connection.connect();

	const result = await syncService
		.syncMessages(
			mailboxId,
			account.accountId,
			account.accountConfigId,
			MESSAGE_BATCH_SIZE,
		)
		.finally(() => connectionFactory.close());
	log.info(
		{
			syncedCount: result.syncedCount,
			hasMore: result.hasMore,
			remainingCount: result.remainingCount,
		},
		"Message sync batch complete",
	);

	if (result.syncedCount > 0) {
		metrics.addMetric(
			"imapMessagesSynced",
			MetricUnit.Count,
			result.syncedCount,
		);
	}

	// Emit body sync events for the messages we just synced. Each event carries
	// messageId+uid pairs so the consumer issues one ranged FETCH per batch
	// without re-resolving UIDs. messageIds stays populated for backward compat.
	if (result.syncedMessages.length > 0) {
		const batches = batchSyncedMessages(result.syncedMessages);

		log.info(
			{ count: result.syncedMessages.length, batches: batches.length },
			"Emitting SYNC_MESSAGE_BODY events",
		);

		await pMap(
			batches,
			(batch) => {
				const bodyEvent: Omit<SyncMessageBodyEvent, "eventId" | "timestamp"> = {
					type: "SYNC_MESSAGE_BODY",
					accountId: event.accountId,
					mailboxId,
					messageIds: batch.map((m) => m.messageId),
					messages: batch.map((m) => ({ messageId: m.messageId, uid: m.uid })),
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

	await mailboxService.update(account.accountId, mailboxId, {
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
