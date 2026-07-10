import { getClient } from "@remit/backend/client";
import type { Logger } from "@remit/logger-lambda";
import {
	BodySyncService,
	MessageMoveService,
} from "@remit/mailbox-service";
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

const bodySyncEnabledParameterName = env.BODY_SYNC_ENABLED_PARAMETER_NAME;

/**
 * Hard ceiling on body-sync retries. Every retry re-enqueues a brand-new SQS
 * message (see `buildRetryEvent`), so the queue's maxReceiveCount/DLQ never
 * sees repeated receives of the same message and can't engage — without an
 * application-level cap, a message that can never be fetched (e.g. expunged
 * from the IMAP server while its row remains, or stale metadata + gone from
 * server) retries forever. Chosen generously above the handful of transient
 * failures (a dropped connection, a slow S3 write) a real message should need,
 * while still bounding the worst case to a small, finite number of attempts.
 *
 * "5 retries" means 6 total fetch attempts: the original invocation
 * (`retryCount` 0) plus 5 re-enqueues (`retryCount` 1 through 5). The
 * invocation that carries `retryCount === MAX_BODY_SYNC_RETRIES` still runs a
 * full `syncBodies` (IMAP FETCH + placement) before the cap check drops it —
 * the cap only stops the *next* re-enqueue, it doesn't skip that last attempt.
 */
export const MAX_BODY_SYNC_RETRIES = 5;

/**
 * Whether a batch that has already failed `retryCount` times should stop
 * retrying. Pure and exported so the cap threshold is unit-testable without
 * driving the full handler.
 */
export const isRetryCapExceeded = (retryCount: number): boolean =>
	retryCount >= MAX_BODY_SYNC_RETRIES;

export interface RetryCapExceededLogPayload {
	alert: string;
	accountId: string;
	mailboxId: string;
	messageIds: string[];
	retryCount: number;
	[key: string]: unknown;
}

/**
 * The loud, alert-shaped log line emitted in place of re-enqueueing once a
 * batch exceeds `MAX_BODY_SYNC_RETRIES`. This log line IS the DLQ-equivalent
 * signal — the SQS-level redrive never engages because each retry is a fresh
 * message, so dropping here without a distinct alert key would make the
 * failure invisible.
 */
export const buildRetryCapExceededLog = (
	accountId: string,
	mailboxId: string,
	failedMessageIds: string[],
	retryCount: number,
): RetryCapExceededLogPayload => ({
	alert: "body-sync-retry-cap-exceeded",
	accountId,
	mailboxId,
	messageIds: failedMessageIds,
	retryCount,
});

/**
 * The ordered message ids to sync, plus a uid lookup when the event carried the
 * preferred `messages` shape. The uid map lets the body-sync service skip the
 * per-message DDB get; legacy events (ids only) leave it undefined and the
 * service resolves uids itself.
 */
export interface ResolvedBatch {
	messageIds: string[];
	uidByMessageId?: Map<string, number>;
	force: boolean;
}

export const resolveBatch = (event: SyncMessageBodyEvent): ResolvedBatch => {
	const force = event.force === true;
	if (event.messages !== undefined) {
		return {
			messageIds: event.messages.map((m) => m.messageId),
			uidByMessageId: new Map(
				event.messages.map((m): [string, number] => [m.messageId, m.uid]),
			),
			force,
		};
	}
	return { messageIds: event.messageIds, force };
};

/**
 * Build the retry event for the FAILED message ids only. A single bad message
 * never re-fetches the whole batch. Uids are carried forward when the original
 * batch knew them so retries keep the one-fetch shape. `force` is carried
 * forward too — a failed force-re-fetch (e.g. a dropped IMAP connection) must
 * keep bypassing the skip guard on retry, otherwise the stale-metadata loop
 * from #1241 reopens on the very first retry. `retryCount` (the number of
 * retries already spent, 0 on the original event) is incremented so the next
 * invocation knows how many attempts preceded it — the cap check in
 * `syncMessageBody` reads this back to stop the loop from running forever.
 */
export const buildRetryEvent = (
	accountId: string,
	mailboxId: string,
	failedMessageIds: string[],
	uidByMessageId?: Map<string, number>,
	force?: boolean,
	retryCount = 0,
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
		...(force && { force }),
		retryCount: retryCount + 1,
	};
};

export const syncMessageBody = async (
	event: SyncMessageBodyEvent,
	log: Logger,
): Promise<void> => {
	const { accountId, mailboxId } = event;
	const retryCount = event.retryCount ?? 0;

	// Prefer the messageId+uid pairs when present (one ranged FETCH, no
	// per-message UID lookup); fall back to the legacy id-only list otherwise.
	const { messageIds, uidByMessageId, force } = resolveBatch(event);

	log.info(
		{
			event: event.type,
			accountId,
			mailboxId,
			messageCount: messageIds.length,
			hasUids: event.messages !== undefined,
			force,
			retryCount,
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

	const {
		account: accountService,
		mailbox: mailboxService,
		mailboxSpecialUse: mailboxSpecialUseService,
		message: messageService,
		threadMessage: threadMessageService,
		address: addressService,
		envelope: envelopeService,
		secrets,
	} = await getClient();

	const account = await accountService.get(accountId);
	if (!account) {
		throw new Error(`Account ${accountId} not found`);
	}

	if (isAccountDeleted(account, log)) {
		return;
	}

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
			const mailbox = await mailboxService.get(accountId, mailboxId);
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
					force,
				)
				.finally(() => borrowed.release());

			// Re-enqueue ONLY the failed messages with a jittered delay (avoid a
			// thundering herd). A single bad message never forces a re-fetch of the
			// whole batch. Carry uids forward when known so retries keep the
			// one-fetch shape. Once `retryCount` exceeds the cap, stop re-enqueueing
			// — the SQS-level redrive never engages here (each retry is a fresh
			// message), so the loud log below is the DLQ-equivalent signal.
			if (result.failedMessageIds.length > 0) {
				if (isRetryCapExceeded(retryCount)) {
					log.error(
						buildRetryCapExceededLog(
							accountId,
							mailboxId,
							result.failedMessageIds,
							retryCount,
						),
						"Body sync retry cap exceeded; dropping message(s) without re-enqueueing",
					);
				} else {
					const retryDelaySeconds = 20 + Math.floor(Math.random() * 21);
					log.info(
						{
							failedCount: result.failedMessageIds.length,
							retryDelaySeconds,
							retryCount,
						},
						"Re-enqueueing failed body syncs with delay",
					);

					const retryEvent = buildRetryEvent(
						accountId,
						mailboxId,
						result.failedMessageIds,
						uidByMessageId,
						force,
						retryCount,
					);
					await emitEvent(retryEvent, { delaySeconds: retryDelaySeconds });
				}
			}
		},
	);
};
