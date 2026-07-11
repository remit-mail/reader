import { getClient } from "@remit/backend/client";
import type { Logger } from "@remit/logger-lambda";
import { MetricUnit, metrics } from "@remit/logger-lambda";
import {
	BodySyncService,
	guardConnectionCursor,
	isCursorRebuildNeeded,
	MailboxCursorPausedError,
	MessageMoveService,
	resolveExhaustedBodySyncFailures,
} from "@remit/mailbox-service";
import { createStorageService } from "@remit/storage-service";
import { env } from "expect-env";
import { isAccountDeleted } from "../account-check.js";
import { isBodySyncEnabled } from "../body-sync-gate.js";
import {
	borrowWarmConnection,
	createConnectionScopeWithCredentials,
} from "../connection-scope.js";
import type { SyncMessageBodyEvent } from "../events.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";

const bodySyncEnabledParameterName = env.BODY_SYNC_ENABLED_PARAMETER_NAME;

/**
 * Fallback when `BODY_SYNC_MAX_ATTEMPTS` is unset (local dev, unit tests).
 * Matches the body queue's own `MAX_RECEIVE_COUNT` default
 * (`infra/stacks/dev/stacks/remit-queue-stack.ts`) so an environment that
 * never injects the var still behaves like production.
 */
const DEFAULT_BODY_SYNC_MAX_ATTEMPTS = 3;

/**
 * Reads the redelivery-budget-exhaustion threshold. CDK derives
 * `BODY_SYNC_MAX_ATTEMPTS` from the body queue's own `MAX_RECEIVE_COUNT`
 * (`remit-worker-stack.ts`) so the two constants can't drift apart — a
 * hand-copied duplicate here previously risked the worker resolving
 * "last attempt" on a different delivery than the queue's redrive policy
 * actually uses (issue #1270). SQS's own `ApproximateReceiveCount` is the
 * source of truth for how many times a record has been delivered; once it
 * reaches this value, the current invocation is the last attempt before the
 * queue's own redrive would DLQ the record, so retry exhaustion is resolved
 * here (see `resolveExhaustedBodySyncFailures`) instead of letting the
 * record dead-letter with no diagnosis.
 */
export const getBodySyncMaxAttempts = (
	processEnv: NodeJS.ProcessEnv = process.env,
): number => {
	const raw = processEnv.BODY_SYNC_MAX_ATTEMPTS;
	if (!raw) return DEFAULT_BODY_SYNC_MAX_ATTEMPTS;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0
		? parsed
		: DEFAULT_BODY_SYNC_MAX_ATTEMPTS;
};

export const BODY_SYNC_MAX_ATTEMPTS = getBodySyncMaxAttempts();

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
 * Build the loud, structured error thrown when a batch still has failed
 * messages and SQS redelivery budget left. Throwing (rather than swallowing
 * into a fresh re-enqueue) is what lets a genuine processing failure reach
 * the body-dlq once `BODY_SYNC_MAX_ATTEMPTS` is exhausted — the SQS-level
 * redrive owns retry scheduling now, not this handler.
 */
export const buildRetryableFailureError = (
	failedMessageIds: string[],
	receiveCount: number,
): Error =>
	new Error(
		`Body sync failed for ${failedMessageIds.length} message(s) ` +
			`(attempt ${receiveCount}/${BODY_SYNC_MAX_ATTEMPTS}): ${failedMessageIds.join(", ")}`,
	);

export const syncMessageBody = async (
	event: SyncMessageBodyEvent,
	log: Logger,
	receiveCount = 1,
): Promise<void> => {
	const { accountId, mailboxId } = event;

	// Prefer the messageId+uid pairs when present (one ranged FETCH, no
	// per-message UID lookup); fall back to the legacy id-only list otherwise.
	const { messageIds, force } = resolveBatch(event);

	log.info(
		{
			event: event.type,
			accountId,
			mailboxId,
			messageCount: messageIds.length,
			hasUids: event.messages !== undefined,
			force,
			receiveCount,
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
			const mailbox = await mailboxService.get(accountId, mailboxId);

			// Cheap frugal skip (epic #1281 invariant 6): a mailbox already known
			// paused never even borrows a connection. This is an optimization only
			// — guardConnectionCursor below is the structural guarantee, so a
			// handler that forgot this check still cannot reach a stale UID.
			if (isCursorRebuildNeeded(mailbox.cursorState)) {
				log.info(
					{ accountId, mailboxId, cursorState: mailbox.cursorState },
					"Mailbox cursor not normal; pausing outbound body sync this round",
				);
				return;
			}

			// Warm reuse: borrow a live IMAP connection from the module-scoped pool
			// (keyed by accountId) instead of dialing a fresh one per invocation. A
			// warm container skips TCP+TLS+LOGIN+SELECT; a dead pooled connection is
			// liveness-checked and replaced inside borrowWarmConnection.
			const borrowed = borrowWarmConnection(accountId, () =>
				createConnectionScopeWithCredentials(account, credentials),
			);
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

			// Guard at the openBox choke point (epic #1281 invariants 3 & 5). The
			// served UIDVALIDITY is only knowable by opening the box, which only a
			// genuine fetch needs — BodySyncService.syncBodies skips connecting
			// entirely when every message already has a stored body (nothing would
			// touch a stored UID either way) — so the check fires lazily, the first
			// time `openBox` is actually called, instead of forcing an extra open
			// on every event.
			const getConnectionChecked = async () =>
				guardConnectionCursor(
					await borrowed.getConnection(),
					{ mailboxService },
					accountId,
					mailbox,
				);

			// Both the sync attempt AND the retry-exhaustion resolution below run
			// against the SAME borrowed connection, so the mailbox stays open
			// across the two — the connection is only released once both are done.
			await (async () => {
				const result = await bodySyncService.syncBodies(
					messageIds,
					accountId,
					account.accountConfigId,
					mailbox.fullPath,
					getConnectionChecked,
					force,
				);

				if (result.failedMessageIds.length === 0) {
					return;
				}

				if (receiveCount < BODY_SYNC_MAX_ATTEMPTS) {
					// Redelivery budget remains: let SQS retry the whole record
					// naturally. Messages that already synced skip via the
					// already-stored guard on the next attempt, so only the failed
					// ones actually redo work. This — not a manual re-enqueue — is
					// what lets a genuine processing failure ever reach the body-dlq.
					throw buildRetryableFailureError(
						result.failedMessageIds,
						receiveCount,
					);
				}

				// Redelivery budget exhausted: a persistent per-message failure is
				// never a steady state (epic #1281 invariant 3). Resolve every
				// failed id into exactly one of the two terminal outcomes instead of
				// letting the record dead-letter with no diagnosis.
				const { reconciledMessageIds, brokenMessageIds } =
					await resolveExhaustedBodySyncFailures(
						{
							messageService,
							threadMessageService,
							storageService: storage,
							log,
						},
						{
							accountId,
							accountConfigId: account.accountConfigId,
							mailboxId,
							mailboxPath: mailbox.fullPath,
							failedMessageIds: result.failedMessageIds,
							getConnection: getConnectionChecked,
						},
					);

				if (reconciledMessageIds.length > 0) {
					metrics.addMetric(
						"bodySyncStaleRowReconciled",
						MetricUnit.Count,
						reconciledMessageIds.length,
					);
				}
				if (brokenMessageIds.length > 0) {
					metrics.addMetric(
						"bodySyncMessageBroken",
						MetricUnit.Count,
						brokenMessageIds.length,
					);
				}
			})()
				.catch((error: unknown) => {
					// Expected pause (epic #1281 invariant 3), not a fault: ack and
					// skip rather than propagating into SQS retry/DLQ. The read stays
					// served from whatever is already stored; the fetch resumes once
					// the mailbox returns to normal.
					if (error instanceof MailboxCursorPausedError) {
						log.info(
							{ accountId, mailboxId, cursorState: error.state },
							"UIDVALIDITY changed; mailbox cursor tripped, pausing outbound body sync",
						);
						return;
					}
					throw error;
				})
				.finally(() => borrowed.release());
		},
	);
};
