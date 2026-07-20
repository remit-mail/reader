import { getClient } from "@remit/backend/client";
import type { Logger } from "@remit/logger-lambda";
import { MetricUnit, metrics } from "@remit/logger-lambda";
import {
	guardConnectionCursor,
	type IImapConnection,
	isCursorRebuildNeeded,
	isMessageGoneFromOpenMailbox,
	MailboxCursorPausedError,
	reconcileStaleMessage,
	resolveExhaustedPlacementMoveFailure,
} from "@remit/mailbox-service";
import { isAccountDeleted } from "../account-check.js";
import { createConnectionScopeWithCredentials } from "../connection-scope.js";
import { emitEvent } from "../emit.js";
import type { PlacementMovePushEvent } from "../events.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";
import {
	buildThreadMessageMoveUpdate,
	emitMoveResync,
} from "./message-move.js";

/**
 * Fallback when `PLACEMENT_MOVE_MAX_ATTEMPTS` is unset (local dev, unit
 * tests). Matches the placement-move queue's own `MAX_RECEIVE_COUNT` default
 * (`infra/stacks/dev/stacks/remit-queue-stack.ts`), same pattern as
 * `BODY_SYNC_MAX_ATTEMPTS` (#1270).
 */
const DEFAULT_PLACEMENT_MOVE_MAX_ATTEMPTS = 3;

export const getPlacementMoveMaxAttempts = (
	processEnv: NodeJS.ProcessEnv = process.env,
): number => {
	const raw = processEnv.PLACEMENT_MOVE_MAX_ATTEMPTS;
	if (!raw) return DEFAULT_PLACEMENT_MOVE_MAX_ATTEMPTS;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0
		? parsed
		: DEFAULT_PLACEMENT_MOVE_MAX_ATTEMPTS;
};

export const PLACEMENT_MOVE_MAX_ATTEMPTS = getPlacementMoveMaxAttempts();

interface MoveOutcome {
	kind: "moved" | "not-found" | "trycreate";
	newUid?: number;
}

/**
 * SEARCH a mailbox for a message by its RFC822 Message-ID header. Read-only
 * (EXAMINE, not SELECT) — this is a verification probe, never a write.
 * Returns the first matching UID, or `null` if nothing matched.
 */
const searchMailboxByMessageId = async (
	connection: IImapConnection,
	mailboxPath: string,
	messageIdHeader: string,
): Promise<number | null> => {
	await connection.openBox(mailboxPath, true);
	const uids = await connection.search([
		`HEADER Message-ID "${messageIdHeader}"`,
	]);
	return uids[0] ?? null;
};

/**
 * Attempt the IMAP MOVE.
 *
 * Takes two connection handles rather than one: `sourceConnection` and
 * `destinationConnection` wrap the SAME underlying connection but are each
 * cursor-guarded (#1272) against their OWN mailbox — a `guardConnectionCursor`
 * wrap binds `openBox` checks to whichever ONE mailbox snapshot it was built
 * with, so verifying at the destination must never run through the source's
 * guard (it would compare the destination's served UIDVALIDITY against the
 * source's stored one and misfire).
 *
 * - `moved` with a `newUid` — confirmed, either via COPYUID or (see below)
 *   an explicit destination verification.
 * - `trycreate` — the destination mailbox doesn't exist yet; the caller
 *   creates it and retries.
 * - `not-found` — confirmed absent from BOTH source and destination. Only
 *   this outcome supersedes the pending-move marker (drops it, reconciles
 *   the row as an external delete).
 * - Any other case throws (propagates for SQS retry, or as
 *   `MailboxCursorPausedError` for the caller's cursor-pause handling) —
 *   including an UNCONFIRMED move (no COPYUID, or an explicit "not
 *   found"/NONEXISTENT from the server) whose message is still sitting at
 *   the source. A MOVE that resolves without a uidMap entry on a
 *   non-UIDPLUS server is a plausible SUCCESS, not evidence the message is
 *   gone (PR #1289 review finding 2) — deleting the local row on that
 *   ambiguity would be data loss. `not-found` is only returned once BOTH a
 *   destination Message-ID search (when the header is known) misses AND
 *   {@link isMessageGoneFromOpenMailbox} confirms the message absent from the
 *   source — a FETCH returning no row does not, on its own, confirm anything.
 */
export const attemptMove = async (
	sourceConnection: IImapConnection,
	destinationConnection: IImapConnection,
	sourceMailboxPath: string,
	destinationMailboxPath: string,
	uid: number,
	messageIdHeader: string | undefined,
): Promise<MoveOutcome> => {
	await sourceConnection.openBox(sourceMailboxPath, false);

	const resolved = await sourceConnection
		.moveMessages([uid], destinationMailboxPath)
		.then((result) => ({ ok: true as const, newUid: result.uidMap.get(uid) }))
		.catch((error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			if (message.includes("TRYCREATE")) {
				return { ok: false as const, trycreate: true as const };
			}
			if (message.includes("not found") || message.includes("NONEXISTENT")) {
				return { ok: false as const, trycreate: false as const };
			}
			throw error;
		});

	if (resolved.ok && resolved.newUid) {
		return { kind: "moved", newUid: resolved.newUid };
	}
	if (!resolved.ok && resolved.trycreate) {
		return { kind: "trycreate" };
	}

	// Unconfirmed: either no COPYUID entry, or the server explicitly claimed
	// "not found" — never trust either without independent verification.
	if (messageIdHeader) {
		const destinationUid = await searchMailboxByMessageId(
			destinationConnection,
			destinationMailboxPath,
			messageIdHeader,
		);
		if (destinationUid) return { kind: "moved", newUid: destinationUid };
	}

	await sourceConnection.openBox(sourceMailboxPath, true);
	if (!(await isMessageGoneFromOpenMailbox(sourceConnection, uid))) {
		throw new Error(
			"Placement move unresolved (unconfirmed at destination, still present at source) — retrying",
		);
	}

	return { kind: "not-found" };
};

/**
 * Handle PLACEMENT_MOVE_PUSH events (issue #1271, epic #1281). Drains ONE
 * pending placement-move marker: resolves the UID fresh from the Message row
 * (never trusts a captured value — invariant 1), pushes the IMAP MOVE, and
 * clears the marker ONLY on confirmed success. Every precedence rule (epic
 * invariant 2) is enforced here:
 * - Pending Remit move wins on location: nothing in this handler ever
 *   corrects `message.mailboxId` back toward the source — a resync elsewhere
 *   (message-sync.ts) never overwrites an existing row's `mailboxId` either
 *   (create-only-if-not-exists semantics), so the local move is never undone.
 * - A NEWER local action superseding this marker (drop without pushing) —
 *   see the `message.mailboxId !== marker.destinationMailboxId` check below.
 * - An external delete supersedes the marker entirely — the `not-found`
 *   outcome drops the marker and reconciles the stale row.
 *
 * Cursor-guarded (#1272, epic #1281 invariant 5): both the source and
 * destination mailbox are checked for a non-`normal` `cursorState` before
 * connecting, and the connection is wrapped per-mailbox via
 * `guardConnectionCursor` so no stored UID touches the server while either
 * mailbox's axis is being rebuilt. A trip pauses the push (routine, no
 * alarm) — the marker stays durable and pushes again on the next event.
 */
export const handlePlacementMovePush = async (
	event: PlacementMovePushEvent,
	log: Logger,
	receiveCount = 1,
): Promise<void> => {
	const {
		account: accountService,
		mailbox: mailboxService,
		message: messageService,
		threadMessage: threadMessageService,
		placementMove: markerService,
		secrets,
	} = await getClient();

	const { accountId, accountConfigId, messageId } = event;

	const marker = await markerService.find(messageId);
	if (!marker) {
		log.info(
			{ messageId, accountId },
			"No pending placement-move marker (already confirmed or superseded); nothing to push",
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

	const message = await messageService.get(messageId);

	// A newer local action (drag-and-drop move, auto-moved Undo) already
	// changed the message's location away from what this marker still
	// promises — that later intent wins locally. Drop the now-stale marker
	// without touching IMAP.
	if (message.mailboxId !== marker.destinationMailboxId) {
		await markerService.delete(messageId);
		log.info(
			{
				messageId,
				accountId,
				markerDestination: marker.destinationMailboxId,
				currentMailboxId: message.mailboxId,
			},
			"Placement move superseded by a newer local action; marker dropped without pushing",
		);
		return;
	}

	// The worker has picked up the event and is about to actually attempt the
	// IMAP MOVE — advance the state engine (pending/queued -> processing).
	// Idempotent to call again on a redelivered event (a prior attempt that
	// died mid-flight already left it here).
	await markerService.updateState(messageId, "processing");

	const sourceMailbox = await mailboxService.get(
		accountId,
		marker.sourceMailboxId,
	);
	const destinationMailbox = await mailboxService.get(
		accountId,
		marker.destinationMailboxId,
	);

	// Cheap frugal skip (epic #1281 invariant 6): either mailbox already known
	// paused never even borrows a connection. Optimization only — the
	// guardConnectionCursor wraps below are the structural guarantee (#1272).
	if (
		isCursorRebuildNeeded(sourceMailbox.cursorState) ||
		isCursorRebuildNeeded(destinationMailbox.cursorState)
	) {
		log.info(
			{
				messageId,
				accountId,
				sourceCursorState: sourceMailbox.cursorState,
				destinationCursorState: destinationMailbox.cursorState,
			},
			"Mailbox cursor not normal; pausing outbound placement-move push this round",
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
					// Guard at the openBox choke point (epic #1281 invariants 3 & 5).
					// Two independently-scoped wraps around the SAME connection — see
					// the attemptMove doc comment for why one guard per mailbox matters.
					const sourceConnection = guardConnectionCursor(
						rawConnection,
						{ mailboxService },
						accountId,
						sourceMailbox,
					);
					const destinationConnection = guardConnectionCursor(
						rawConnection,
						{ mailboxService },
						accountId,
						destinationMailbox,
					);

					const outcome = await attemptMove(
						sourceConnection,
						destinationConnection,
						sourceMailbox.fullPath,
						destinationMailbox.fullPath,
						message.uid,
						message.messageIdHeader,
					);

					if (outcome.kind === "trycreate") {
						await destinationConnection.createMailbox(
							destinationMailbox.fullPath,
						);
						throw new Error(
							`Destination mailbox ${destinationMailbox.fullPath} did not exist; created, retrying`,
						);
					}

					if (outcome.kind === "not-found") {
						// External delete supersedes the marker entirely (epic invariant 2).
						await markerService.delete(messageId);
						const { threadMessagesDeleted } = await reconcileStaleMessage(
							{ messageService, threadMessageService },
							accountConfigId,
							messageId,
						);
						log.info(
							{
								messageId,
								accountId,
								uid: message.uid,
								sourceMailboxPath: sourceMailbox.fullPath,
								threadMessagesDeleted,
							},
							"Message no longer at its pending-move source (external delete or moved away); marker dropped, stale row reconciled",
						);
						await emitMoveResync(emitEvent, {
							accountId,
							sourceMailboxId: marker.sourceMailboxId,
							destinationMailboxId: marker.destinationMailboxId,
						});
						return;
					}

					const newUid = outcome.newUid as number;
					await messageService.updateUid(
						messageId,
						newUid,
						marker.destinationMailboxId,
					);

					const threadMessage = await threadMessageService.findByMessageId(
						accountConfigId,
						messageId,
					);
					if (threadMessage) {
						const args = buildThreadMessageMoveUpdate(
							threadMessage,
							newUid,
							marker.destinationMailboxId,
						);
						await threadMessageService.update(
							threadMessage.accountConfigId,
							threadMessage.threadMessageId,
							args.set,
							{ composites: args.composites },
						);
					}

					// Confirmed IMAP acknowledgement — the "processed" terminal state.
					// Deleted immediately rather than persisted first (epic invariant
					// 4: no lingering row once the move is no longer pending) — clears
					// ONLY here, never on attempt (the defect issue #1271 fixes).
					await markerService.delete(messageId);

					log.info(
						{
							messageId,
							accountId,
							oldUid: message.uid,
							newUid,
							destination: destinationMailbox.fullPath,
						},
						"Placement move confirmed on IMAP; marker cleared",
					);

					await emitMoveResync(emitEvent, {
						accountId,
						sourceMailboxId: marker.sourceMailboxId,
						destinationMailboxId: marker.destinationMailboxId,
					});
				})
				.catch(async (error: unknown) => {
					// Expected pause (epic #1281 invariant 3), not a fault: ack and
					// skip rather than propagating into SQS retry/DLQ. The marker
					// stays durable; the push resumes once the mailbox returns to
					// normal (driven by the next PLACEMENT_MOVE_PUSH for this message,
					// or the surviving-marker re-enqueue in PlacementMoveService).
					if (error instanceof MailboxCursorPausedError) {
						log.info(
							{ messageId, accountId, cursorState: error.state },
							"UIDVALIDITY changed; mailbox cursor tripped, pausing outbound placement-move push",
						);
						return;
					}

					if (receiveCount < PLACEMENT_MOVE_MAX_ATTEMPTS) {
						// Transient push failure — expected (connections drop). No alarm;
						// SQS redelivery retries from the still-durable marker.
						throw error;
					}

					// Redelivery budget exhausted: resolve into exactly one of the two
					// terminal outcomes (epic invariant 3) instead of dead-lettering
					// with no diagnosis.
					const { outcome } = await resolveExhaustedPlacementMoveFailure(
						{ markerService, messageService, threadMessageService, log },
						{
							accountId,
							accountConfigId,
							messageId,
							uid: message.uid,
							sourceMailboxPath: sourceMailbox.fullPath,
							getConnection: scope.getConnection,
						},
					);

					if (outcome === "reconciled") {
						metrics.addMetric(
							"placementMoveStaleRowReconciled",
							MetricUnit.Count,
							1,
						);
						await emitMoveResync(emitEvent, {
							accountId,
							sourceMailboxId: marker.sourceMailboxId,
							destinationMailboxId: marker.destinationMailboxId,
						});
						return;
					}

					metrics.addMetric("placementMoveFailed", MetricUnit.Count, 1);
					log.error(
						{ error: error instanceof Error ? error.message : String(error) },
						"Placement move retry exhausted; message still exists at its source",
					);
					// Terminal — never re-thrown, so the caller acks either way.
				})
				.finally(() => scope.disconnect());
		},
	);
};
