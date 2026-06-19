import {
	AccountService,
	AddressService,
	EnvelopeService,
	getClient,
	MailboxService,
	MailboxSpecialUseService,
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/remit-logger-lambda";
import {
	BodySyncService,
	MessageMoveService,
} from "@remit/mailbox-service";
import {
	createKmsDataKeyProvider,
	createSecretsService,
} from "@remit/secrets-service";
import { createStorageService } from "@remit/storage-service";
import { env } from "expect-env";
import { isAccountDeleted } from "../account-check.js";
import { isBodySyncEnabled } from "../body-sync-gate.js";
import {
	borrowWarmConnection,
	createConnectionScopeWithCredentials,
} from "../connection-scope.js";
import { emitEvent } from "../emit.js";
import type { SyncMessageBodyEvent, SyncMessageBodyTarget } from "../events.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";

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
const mailboxSpecialUseService = new MailboxSpecialUseService({
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
const envelopeService = new EnvelopeService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});

const bodySyncEnabledParameterName = env.BODY_SYNC_ENABLED_PARAMETER_NAME;

const messageMgmtQueueUrl = process.env.SQS_QUEUE_URL_MESSAGE_MGMT;
const messageMoveService = messageMgmtQueueUrl
	? new MessageMoveService({
			messageService,
			mailboxService,
			mailboxSpecialUseService,
			threadMessageService,
			sqsQueueUrl: messageMgmtQueueUrl,
		})
	: undefined;

/**
 * The ordered message ids to sync, plus a uid lookup when the event carried the
 * preferred `messages` shape. The uid map lets the body-sync service skip the
 * per-message DDB get; legacy events (ids only) leave it undefined and the
 * service resolves uids itself.
 */
export interface ResolvedBatch {
	messageIds: string[];
	uidByMessageId?: Map<string, number>;
}

export const resolveBatch = (event: SyncMessageBodyEvent): ResolvedBatch => {
	if (event.messages !== undefined) {
		return {
			messageIds: event.messages.map((m) => m.messageId),
			uidByMessageId: new Map(
				event.messages.map((m): [string, number] => [m.messageId, m.uid]),
			),
		};
	}
	return { messageIds: event.messageIds };
};

/**
 * Build the retry event for the FAILED message ids only. A single bad message
 * never re-fetches the whole batch. Uids are carried forward when the original
 * batch knew them so retries keep the one-fetch shape.
 */
export const buildRetryEvent = (
	accountId: string,
	mailboxId: string,
	failedMessageIds: string[],
	uidByMessageId?: Map<string, number>,
): Omit<SyncMessageBodyEvent, "eventId" | "timestamp"> => {
	const messages = uidByMessageId
		? failedMessageIds.map((messageId): SyncMessageBodyTarget => {
				const uid = uidByMessageId.get(messageId);
				// A failed id always came from this batch's uid map; a missing uid
				// is a programmer error, never UID 0 (which would fetch the wrong
				// message). Fail loud instead of silently retrying a bad uid.
				if (uid === undefined) {
					throw new Error(
						`No uid for failed messageId ${messageId} in retry batch`,
					);
				}
				return { messageId, uid };
			})
		: undefined;

	return {
		type: "SYNC_MESSAGE_BODY",
		accountId,
		mailboxId,
		messageIds: failedMessageIds,
		...(messages && { messages }),
	};
};

export const syncMessageBody = async (
	event: SyncMessageBodyEvent,
	log: Logger,
): Promise<void> => {
	const { accountId, mailboxId } = event;

	// Prefer the messageId+uid pairs when present (one ranged FETCH, no
	// per-message UID lookup); fall back to the legacy id-only list otherwise.
	const { messageIds, uidByMessageId } = resolveBatch(event);

	log.info(
		{
			event: event.type,
			accountId,
			mailboxId,
			messageCount: messageIds.length,
			hasUids: event.messages !== undefined,
		},
		"Handling event",
	);

	// Pause gate stays first: ack-and-skip before touching any account/IMAP state.
	if (!(await isBodySyncEnabled(bodySyncEnabledParameterName, log))) {
		log.info(
			{
				event: event.type,
				accountId,
				mailboxId,
				messageCount: messageIds.length,
			},
			"Body sync paused via SSM toggle, acking and skipping",
		);
		return;
	}

	const account = await accountService.get(accountId);
	if (!account) {
		throw new Error(`Account ${accountId} not found`);
	}

	if (isAccountDeleted(account, log)) {
		return;
	}

	await withOAuthLifecycle(
		buildLifecycleDeps(secrets, accountService),
		account,
		log,
		async (credentials) => {
			// Warm reuse: borrow a live IMAP connection from the module-scoped pool
			// (keyed by accountId) instead of dialing a fresh one per invocation. A
			// warm container skips TCP+TLS+LOGIN+SELECT; a dead pooled connection is
			// liveness-checked and replaced inside borrowWarmConnection.
			const borrowed = borrowWarmConnection(accountId, () =>
				createConnectionScopeWithCredentials(account, credentials),
			);
			const mailbox = await mailboxService.get(mailboxId);
			const storage = createStorageService();

			// A confident, actionable placement verdict moves mail directly on
			// body-sync. Safety lives in the verdict itself (only confident,
			// INBOX/Junk-only) and the movedByRemit loop guard.
			const placementConfig = messageMoveService
				? {
						mailboxSpecialUseService,
						messageMoveService,
					}
				: undefined;

			const bodySyncService = new BodySyncService(
				messageService,
				storage,
				threadMessageService,
				addressService,
				envelopeService,
				log,
				placementConfig,
			);

			// Return the connection to the pool (no disconnect) so the next
			// invocation in this container reuses it; the pool owns teardown.
			const result = await bodySyncService
				.syncBodies(
					messageIds,
					accountId,
					account.accountConfigId,
					mailbox.fullPath,
					borrowed.getConnection,
				)
				.finally(() => borrowed.release());

			// Re-enqueue ONLY the failed messages with a jittered delay (avoid a
			// thundering herd). A single bad message never forces a re-fetch of the
			// whole batch. Carry uids forward when known so retries keep the
			// one-fetch shape.
			if (result.failedMessageIds.length > 0) {
				const retryDelaySeconds = 20 + Math.floor(Math.random() * 21);
				log.info(
					{ failedCount: result.failedMessageIds.length, retryDelaySeconds },
					"Re-enqueueing failed body syncs with delay",
				);

				const retryEvent = buildRetryEvent(
					accountId,
					mailboxId,
					result.failedMessageIds,
					uidByMessageId,
				);
				await emitEvent(retryEvent, { delaySeconds: retryDelaySeconds });
			}
		},
	);
};
