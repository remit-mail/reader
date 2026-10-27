import { isNotFoundError } from "@remit/data-ports/errors";
import {
	BodySyncService,
	guardConnectionCursor,
	isCursorRebuildNeeded,
	isFolderMutationInFlight,
	MailboxCursorPausedError,
	PlacementMoveService,
	QuarantineService,
	resolveExhaustedBodySyncFailures,
	resolveFolderPlacement,
	SyncWarningService,
} from "@remit/mailbox-service";
import { buildFilterConfig } from "@remit/mailbox-service/filter-config";
import { isAccountDeleted } from "../account-check.js";
import type { ProcessContext } from "../context.js";
import type { SyncMessageBodyEvent } from "../events.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";

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
	maxAttempts: number,
): Error =>
	new Error(
		`Body sync failed for ${failedMessageIds.length} message(s) ` +
			`(attempt ${receiveCount}/${maxAttempts}): ${failedMessageIds.join(", ")}`,
	);

export const syncMessageBody = async (
	event: SyncMessageBodyEvent,
	ctx: ProcessContext,
	receiveCount: number,
): Promise<void> => {
	const { log, queues, pool, metrics, config } = ctx;
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

	const {
		account: accountService,
		mailbox: mailboxService,
		mailboxSpecialUse: mailboxSpecialUseService,
		message: messageService,
		threadMessage: threadMessageService,
		address: addressService,
		envelope: envelopeService,
		placementMove: markerService,
		filter: filterService,
		messageLabel: messageLabelService,
		storage,
		secrets,
		mailboxSpecialUse: mailboxSpecialUseRepository,
		quarantine: quarantineRepository,
		syncWarning: syncWarningRepository,
		flagQueue: flagQueueService,
		calendarSuggestion: calendarSuggestionService,
		calendarStore,
	} = ctx.client;

	const account = await accountService.get(accountId);
	if (!account) {
		throw new Error(`Account ${accountId} not found`);
	}

	if (isAccountDeleted(account, log)) {
		return;
	}

	// PLACEMENT_MOVE_PUSH rides messageMgmtQueue (issue #1271) — same queue
	// the general MessageMoveService move/delete/copy machinery uses, not a
	// dedicated one.
	const placementMoveService = new PlacementMoveService({
		messageService,
		threadMessageService,
		markerService,
		addressService,
		mailboxSpecialUseService,
		mailboxService,
		queue: queues.messageManagement,
	});

	await withOAuthLifecycle(
		buildLifecycleDeps(secrets, accountService, ctx.oauth),
		account,
		log,
		async (credentials) => {
			// A SYNC_MESSAGE_BODY trigger can outlive the mailbox it targets: deleting
			// a folder that held mail leaves already-queued body events pointing at a
			// row that is now gone, and the lookup then throws NotFoundError forever.
			// Since the body queue carries MessageGroupId=accountId, that head message
			// stalls the account's whole body pipeline (issues #287, #289, #290). A
			// deleted folder is an expected terminal outcome: ack with a WARN.
			const mailbox = await mailboxService
				.get(accountId, mailboxId)
				.catch((error: unknown) => {
					if (isNotFoundError(error)) return null;
					throw error;
				});
			// A folder still `pending` is terminal for the same reason: the batch
			// was cut before the folder reached the server, so there is nothing
			// there to fetch from and no retry that changes it.
			if (!mailbox || isFolderMutationInFlight(mailbox)) {
				log.warn(
					{ accountId, mailboxId, eventId: event.eventId },
					"Skipping SYNC_MESSAGE_BODY: a folder mutation is in flight",
				);
				return;
			}

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

			const borrowed = pool.borrow(account, credentials);

			// A confident, actionable placement verdict moves mail directly on
			// body-sync. Safety lives in the verdict itself (only confident,
			// INBOX/Junk-only) and the movedByRemit loop guard.
			const placementConfig = {
				mailboxSpecialUseService,
				placementMoveService,
			};

			// A matched filter's actions (label upsert, exclusive move) apply on
			// the same body-sync pass, reusing the placement mover for the move
			// (RFC 034 Decision 3.1).
			const filterConfig = buildFilterConfig({
				filterService,
				messageLabelService,
				mailboxService,
				placementMoveService,
			});

			const bodySyncService = new BodySyncService(
				messageService,
				storage,
				threadMessageService,
				addressService,
				envelopeService,
				new SyncWarningService(syncWarningRepository),
				log,
				placementConfig,
				filterConfig,
				{
					quarantineService: new QuarantineService(
						quarantineRepository,
						mailboxSpecialUseRepository,
						config.workerVersion,
						log,
					),
					mailboxId,
					uidValidity: mailbox.uidValidity ?? 0,
					attempts: receiveCount,
				},
				{ flagQueueService },
				// An invitation becomes a card the first time the message is seen,
				// alongside the filters that run on the same pass (issue #1033).
				{ calendarSuggestionService, calendarStore, filterService },
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
			const folder = {
				mailboxId: mailbox.mailboxId,
				fullPath: mailbox.fullPath,
				uidValidity: mailbox.uidValidity,
				placement: await resolveFolderPlacement(
					mailboxSpecialUseService,
					accountId,
					mailbox.mailboxId,
				),
			};

			await (async () => {
				const result = await bodySyncService.syncBodies(
					messageIds,
					accountId,
					account.accountConfigId,
					folder,
					getConnectionChecked,
					{ force, concurrency: config.bodyProcessConcurrency },
				);

				if (result.failedMessageIds.length === 0) {
					return;
				}

				if (receiveCount < config.attempts.body) {
					// Redelivery budget remains: let SQS retry the whole record
					// naturally. Messages that already synced skip via the
					// already-stored guard on the next attempt, so only the failed
					// ones actually redo work. This — not a manual re-enqueue — is
					// what lets a genuine processing failure ever reach the body-dlq.
					throw buildRetryableFailureError(
						result.failedMessageIds,
						receiveCount,
						config.attempts.body,
					);
				}

				// Redelivery budget exhausted: a persistent per-message failure is
				// never a steady state (epic #1281 invariant 3). Resolve every
				// failed id into exactly one of the two terminal outcomes instead of
				// letting the record dead-letter with no diagnosis.
				const { brokenMessageIds } = await resolveExhaustedBodySyncFailures(
					{
						messageService,
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

				// A broken body is terminal on a record the handler acks, so the
				// handler-outcome series never sees it.
				if (brokenMessageIds.length > 0) {
					metrics.imapFailure(
						"SYNC_MESSAGE_BODY_BROKEN",
						"other",
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
