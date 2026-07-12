import {
	AccountService,
	getClient,
	MailboxService,
	MessageFlagPushService,
	MessageService,
	NotFoundError,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/remit-logger-lambda";
import { MetricUnit, metrics } from "@remit/remit-logger-lambda";
import {
	guardConnectionCursor,
	isCursorRebuildNeeded,
	MailboxCursorPausedError,
	resolveExhaustedFlagPushFailure,
} from "@remit/mailbox-service";
import {
	createKmsDataKeyProvider,
	createSecretsService,
} from "@remit/secrets-service";
import { env } from "expect-env";
import { isAccountDeleted } from "../account-check.js";
import { createConnectionScopeWithCredentials } from "../connection-scope.js";
import type { FlagPushEvent } from "../events.js";
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
const messageService = new MessageService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});
const threadMessageService = new ThreadMessageService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});
const markerService = new MessageFlagPushService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});

/**
 * Fallback when `FLAG_PUSH_MAX_ATTEMPTS` is unset (local dev, unit tests).
 * Matches the shared `MAX_RECEIVE_COUNT` every queue's redrive policy uses
 * (`infra/stacks/dev/stacks/remit-queue-stack.ts`), same pattern as
 * `BODY_SYNC_MAX_ATTEMPTS` (#1270) / `PLACEMENT_MOVE_MAX_ATTEMPTS` (#1289).
 */
const DEFAULT_FLAG_PUSH_MAX_ATTEMPTS = 3;

export const getFlagPushMaxAttempts = (
	processEnv: NodeJS.ProcessEnv = process.env,
): number => {
	const raw = processEnv.FLAG_PUSH_MAX_ATTEMPTS;
	if (!raw) return DEFAULT_FLAG_PUSH_MAX_ATTEMPTS;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0
		? parsed
		: DEFAULT_FLAG_PUSH_MAX_ATTEMPTS;
};

export const FLAG_PUSH_MAX_ATTEMPTS = getFlagPushMaxAttempts();

/**
 * Handle FLAG_PUSH events (issue #1273, epic #1281). Drains ONE pending
 * flag-push marker: resolves the message's UID and CURRENT mailbox fresh
 * from the Message row (never a value captured at enqueue — invariant 1),
 * pushes the IMAP STORE (add or remove, per the marker's `operation`), and
 * clears the marker ONLY on confirmed success.
 *
 * Precedence (epic invariant 2):
 * - While pending, resync never reverts the flag — nothing in this handler
 *   (or anywhere else) reads flags FROM IMAP back into `MessageFlag`/
 *   `ThreadMessage` for an existing row; the only flag-state writes happen
 *   here (confirmed push) or in `FlagQueueService` (the user's own local
 *   flip, which already applied before this marker existed).
 * - A later flip of the SAME field already replaced this marker (`put`) by
 *   the time this event is processed, OR advanced it past `pending` — either
 *   way `markerService.find` returns the CURRENT marker, so this handler
 *   always drives the freshest intent, never a stale one.
 * - An external delete supersedes the marker entirely — handled by
 *   `resolveExhaustedFlagPushFailure`'s `reconciled` outcome.
 *
 * Cursor-guarded (#1272, epic #1281 invariant 5): the connection is wrapped
 * via `guardConnectionCursor` around the mailbox's current `openBox` choke
 * point, so no stored UID touches the server while the mailbox's axis is
 * being rebuilt. A trip pauses the push (routine, no alarm) — the marker
 * stays durable and pushes again on the next event or sync tick.
 */
export const handleFlagPush = async (
	event: FlagPushEvent,
	log: Logger,
	receiveCount = 1,
): Promise<void> => {
	const { accountId, accountConfigId, messageId, flagName } = event;

	const marker = await markerService.find(messageId, flagName);
	if (!marker) {
		log.info(
			{ messageId, flagName, accountId },
			"No pending flag-push marker (already confirmed or superseded); nothing to push",
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

	const message = await messageService
		.get(messageId)
		.catch((error: unknown) => {
			if (error instanceof NotFoundError) return null;
			throw error;
		});

	// The message row is already gone — some other reconciliation path (body
	// sync, placement move, a prior flag-push exhaustion) already deleted it.
	// The marker is orphaned; drop it without touching IMAP.
	if (!message) {
		await markerService.delete(messageId, flagName);
		log.info(
			{ messageId, flagName, accountId },
			"Message row no longer exists; flag-push marker dropped without pushing",
		);
		return;
	}

	// The worker has picked up the event and is about to actually attempt the
	// IMAP STORE — advance the state engine (pending/queued -> processing).
	// Idempotent to call again on a redelivered event (a prior attempt that
	// died mid-flight already left it here).
	await markerService.updateState(messageId, flagName, "processing");

	const mailbox = await mailboxService.get(accountId, message.mailboxId);

	// Cheap frugal skip (epic #1281 invariant 6): a mailbox already known
	// paused never even borrows a connection. Optimization only — the
	// guardConnectionCursor wrap below is the structural guarantee (#1272).
	if (isCursorRebuildNeeded(mailbox.cursorState)) {
		log.info(
			{ messageId, flagName, accountId, cursorState: mailbox.cursorState },
			"Mailbox cursor not normal; pausing outbound flag push this round",
		);
		return;
	}

	await withOAuthLifecycle(
		buildLifecycleDeps(secrets, accountService),
		account,
		log,
		async (credentials) => {
			const scope = createConnectionScopeWithCredentials(account, credentials);

			await scope
				.getConnection()
				.then(async (rawConnection) => {
					const connection = guardConnectionCursor(
						rawConnection,
						{ mailboxService },
						accountId,
						mailbox,
					);

					await connection.openBox(mailbox.fullPath, false);

					if (marker.operation === "add") {
						await connection.addFlags([message.uid], [flagName]);
					} else {
						await connection.removeFlags([message.uid], [flagName]);
					}

					// Confirmed IMAP acknowledgement — clears ONLY here, never on
					// attempt (the defect issue #1273 fixes).
					await markerService.delete(messageId, flagName);

					log.info(
						{
							messageId,
							flagName,
							accountId,
							operation: marker.operation,
							uid: message.uid,
							mailboxPath: mailbox.fullPath,
						},
						"Flag push confirmed on IMAP; marker cleared",
					);
				})
				.catch(async (error: unknown) => {
					// Expected pause (epic #1281 invariant 3), not a fault: ack and
					// skip rather than propagating into queue retry/DLQ. The marker
					// stays durable; the push resumes once the mailbox returns to
					// normal.
					if (error instanceof MailboxCursorPausedError) {
						log.info(
							{ messageId, flagName, accountId, cursorState: error.state },
							"UIDVALIDITY changed; mailbox cursor tripped, pausing outbound flag push",
						);
						return;
					}

					if (receiveCount < FLAG_PUSH_MAX_ATTEMPTS) {
						// Transient push failure — expected (connections drop). No
						// alarm; queue redelivery retries from the still-durable marker.
						throw error;
					}

					// Redelivery budget exhausted: resolve into exactly one of the
					// two terminal outcomes (epic invariant 3) instead of
					// dead-lettering with no diagnosis.
					const { outcome } = await resolveExhaustedFlagPushFailure(
						{ markerService, messageService, threadMessageService, log },
						{
							accountId,
							accountConfigId,
							messageId,
							flagName,
							uid: message.uid,
							mailboxPath: mailbox.fullPath,
							getConnection: scope.getConnection,
						},
					);

					if (outcome === "reconciled") {
						metrics.addMetric(
							"flagPushStaleRowReconciled",
							MetricUnit.Count,
							1,
						);
						return;
					}

					metrics.addMetric("flagPushFailed", MetricUnit.Count, 1);
					log.error(
						{ error: error instanceof Error ? error.message : String(error) },
						"Flag push retry exhausted; message still exists at its mailbox",
					);
					// Terminal — never re-thrown, so the caller acks either way.
				})
				.finally(() => scope.disconnect());
		},
	);
};
