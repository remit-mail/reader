import { getClient } from "@remit/backend/client";
import type { Logger } from "@remit/logger-lambda";
import { recordImapFailure } from "@remit/logger-lambda";
import {
	guardConnectionCursor,
	isCursorRebuildNeeded,
	isPlacementUnsettled,
	MailboxCursorPausedError,
	resolveExhaustedFlagPushFailure,
} from "@remit/mailbox-service";
import { attemptBudget } from "@remit/sqs-client/attempt-budget";
import { isAccountDeleted } from "../account-check.js";
import { createConnectionScopeWithCredentials } from "../connection-scope.js";
import type { FlagPushEvent } from "../events.js";
import { isNotFoundError } from "../is-not-found.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";

export const getFlagPushMaxAttempts = (
	processEnv: NodeJS.ProcessEnv = process.env,
): number => attemptBudget("FLAG_PUSH_MAX_ATTEMPTS", 3, processEnv);

export const FLAG_PUSH_MAX_ATTEMPTS = getFlagPushMaxAttempts();

/**
 * How long a marker may sit deferred behind a move before it is dropped
 * outright. A move that settles takes seconds to low minutes; one stuck past
 * this window has almost certainly already exhausted its own retries and been
 * resolved as broken by its own terminal resolver, so deferring further would
 * cycle one SQS round trip per sync tick forever instead of surfacing the
 * stall.
 */
const DEFAULT_FLAG_PUSH_DEFER_MAX_MS = 10 * 60 * 1000;

export const getFlagPushDeferMaxMs = (
	processEnv: NodeJS.ProcessEnv = process.env,
): number => {
	const raw = processEnv.FLAG_PUSH_DEFER_MAX_MS;
	if (!raw) return DEFAULT_FLAG_PUSH_DEFER_MAX_MS;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0
		? parsed
		: DEFAULT_FLAG_PUSH_DEFER_MAX_MS;
};

export const FLAG_PUSH_DEFER_MAX_MS = getFlagPushDeferMaxMs();

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
	const {
		account: accountService,
		mailbox: mailboxService,
		message: messageService,
		threadMessage: threadMessageService,
		flagPush: markerService,
		secrets,
	} = await getClient();

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

	const [message] = await messageService.get([messageId]);

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

	// The message carries a move still in flight — `MessageMoveService`'s or
	// `PlacementMoveService`'s local optimistic write, not yet confirmed by the
	// server. A STORE resolved against this row addresses the destination
	// folder at the SOURCE folder's uid: a different message (issue #496). This
	// is the wait half of the wait-or-reconcile decision
	// (docs/architecture/imap-mutations.md R2) — the push blocks until the move
	// it depends on settles.
	if (isPlacementUnsettled(message)) {
		const deferredForMs = Date.now() - marker.createdAt;

		if (deferredForMs > FLAG_PUSH_DEFER_MAX_MS) {
			// The move this push was waiting on never settled within any
			// reasonable window — deferring further would cycle one SQS round
			// trip per sync tick forever. Drop the stale marker loudly rather
			// than push against state nobody has confirmed.
			await markerService.delete(messageId, flagName);
			recordImapFailure("FLAG_PUSH_MOVE_NEVER_SETTLED", "other");
			log.error(
				{
					alert: "flag_push_move_never_settled",
					messageId,
					flagName,
					accountId,
					deferredForMs,
				},
				"Message move never settled; dropping the flag-push marker that was waiting on it",
			);
			return;
		}

		// Reset to `pending` rather than advancing: `drainPendingFlagPushes`
		// only re-arms markers in that state, scoped by the marker's own
		// `mailboxId` (the push destination), so the next periodic sync tick
		// of that mailbox picks this back up once the move has settled.
		await markerService.updateState(messageId, flagName, "pending");
		log.info(
			{ messageId, flagName, accountId, deferredForMs },
			"Message has a move in flight; pausing outbound flag push until it settles",
		);
		return;
	}

	// The worker has picked up the event and is about to actually attempt the
	// IMAP STORE — advance the state engine (pending/queued -> processing).
	// Idempotent to call again on a redelivered event (a prior attempt that
	// died mid-flight already left it here).
	await markerService.updateState(messageId, flagName, "processing");

	// The folder can be deleted between enqueue and this push, leaving a marker
	// pointing at a gone row. The lookup then throws NotFoundError forever, and
	// on the account's per-group FIFO that head message stalls the whole pipeline
	// (issues #287, #289, #290). The push is moot — drop the orphaned marker (as
	// the message-gone branch above already does) and ack with a WARN.
	const mailbox = await mailboxService
		.get(accountId, message.mailboxId)
		.catch((error: unknown) => {
			if (isNotFoundError(error)) return null;
			throw error;
		});
	if (!mailbox) {
		await markerService.delete(messageId, flagName);
		log.warn(
			{ messageId, flagName, accountId, mailboxId: message.mailboxId },
			"Skipping FLAG_PUSH: mailbox no longer exists (deleted); marker dropped",
		);
		return;
	}

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
						return;
					}

					// Terminal and never re-thrown, so the handler-outcome series
					// records this record as a success. Counted here or it is invisible.
					recordImapFailure("FLAG_PUSH_EXHAUSTED", "other");
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
