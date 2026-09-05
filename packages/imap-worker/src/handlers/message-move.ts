import { getClient } from "@remit/backend/client";
import type { ThreadMessageItem } from "@remit/data-ports";
import { MessageSyncStatus } from "@remit/domain-enums";
import type { Logger } from "@remit/logger-lambda";
import { recordImapFailure } from "@remit/logger-lambda";
import {
	guardConnectionCursor,
	type IImapConnection,
	isCursorRebuildNeeded,
	isPlacementUnsettled,
	MailboxCursorPausedError,
} from "@remit/mailbox-service";
import { attemptBudget } from "@remit/sqs-client/attempt-budget";
import { isAccountDeleted } from "../account-check.js";
import { createConnectionScopeWithCredentials } from "../connection-scope.js";
import { emitEvent } from "../emit.js";
import type { MessageMoveEvent, SyncMessagesEvent } from "../events.js";
import { isNotFoundError } from "../is-not-found.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";
import { resolveExhaustedMessageMoveFailure } from "./message-move-terminal.js";

export const getMessageMoveMaxAttempts = (
	processEnv: NodeJS.ProcessEnv = process.env,
): number => attemptBudget("MESSAGE_MOVE_MAX_ATTEMPTS", 3, processEnv);

export const MESSAGE_MOVE_MAX_ATTEMPTS = getMessageMoveMaxAttempts();

type EmitSyncMessages = (
	event: Omit<SyncMessagesEvent, "eventId" | "timestamp">,
) => Promise<unknown>;

/**
 * Re-read both folders' counts from IMAP after a move by enqueuing the existing
 * per-folder SYNC_MESSAGES sync. Counts are a projection of IMAP, never mutated
 * locally — the move shifted a message between source and destination, so both
 * folders must refresh through the one-way pipeline.
 */
export const emitMoveResync = async (
	emit: EmitSyncMessages,
	params: {
		accountId: string;
		sourceMailboxId: string;
		destinationMailboxId: string;
	},
): Promise<void> => {
	const { accountId, sourceMailboxId, destinationMailboxId } = params;
	await Promise.all(
		[sourceMailboxId, destinationMailboxId].map((mailboxId) =>
			emit({ type: "SYNC_MESSAGES", accountId, mailboxId }),
		),
	);
};

/**
 * SEARCH a mailbox for copies of a message identified by its RFC822 Message-ID
 * header and answer the HIGHEST matching uid. Read-only (EXAMINE, not SELECT) —
 * this is a verification probe, never a write. `null` when nothing matched.
 *
 * The highest uid is the freshly delivered copy only when one exists; deciding
 * that it does is the caller's job, not this function's. Every probe in this
 * package wants the highest: uids ascend with arrival inside a UIDVALIDITY, so a
 * copy that has just landed outranks every copy of the same Message-ID the
 * folder already held. Where nothing was delivered, the highest is simply the
 * newest pre-existing copy, and a caller that has not ruled that case out binds
 * itself to unrelated mail.
 * One Message-ID can have several server copies in one account (a sieve
 * `fileinto` + `keep`, a resend, a repeated COPY — `deriveCopyMessageId` reuses
 * the row, so the second copy is a second server COPY), while `deriveMessageId`
 * is folder-independent and gives them one local row. Taking the lowest bound
 * the fresh copy's row to an older copy's uid and orphaned the fresh one, which
 * a later delete or Empty Trash then expunged by the wrong uid (issue #1122).
 *
 * The maximum is computed rather than read off the tail: RFC 3501 leaves the
 * order of a SEARCH response unspecified, so "last returned" is not "highest".
 */
export const searchMailboxForHighestMessageIdUid = async (
	connection: IImapConnection,
	mailboxPath: string,
	messageIdHeader: string,
): Promise<number | null> => {
	await connection.openBox(mailboxPath, true);
	const uids = await connection.search([
		["HEADER", "Message-ID", messageIdHeader],
	]);
	if (uids.length === 0) return null;
	return uids.reduce((highest, uid) => (uid > highest ? uid : highest));
};

/**
 * Resync the affected folders only once the IMAP move has resolved. A move that
 * fails (or is retried) must not refresh counts off a move that didn't happen,
 * so the resync is sequenced strictly after `performMove`.
 */
export const moveThenResync = async (
	performMove: () => Promise<void>,
	resync: () => Promise<void>,
): Promise<void> => {
	await performMove();
	await resync();
};

/**
 * Build the `set` and `composites` payload for the ThreadMessage update on a
 * MESSAGE_MOVE.
 *
 * The CURRENT row state goes in `composites`; the NEW values go in `set`.
 * ElectroDB uses `composites` to run the conditional check on the existing row
 * AND to compute the previous sort-key values needed to recompute the new ones.
 * Passing the NEW values in `composites` makes the conditional check fail with
 * ConditionalCheckFailedException, which ElectroDB wraps as NotFoundError, and
 * the caller silently drops the update. Same root cause as PR #186 fixed for
 * `flag-queue.ts`.
 */
export const buildThreadMessageMoveUpdate = (
	threadMessage: Pick<
		ThreadMessageItem,
		| "sentDate"
		| "mailboxId"
		| "isRead"
		| "isDeleted"
		| "hasStars"
		| "hasAttachment"
	>,
	newUid: number,
	destinationMailboxId: string,
) => ({
	set: {
		uid: newUid,
		mailboxId: destinationMailboxId,
		isDeleted: false,
	},
	composites: {
		sentDate: threadMessage.sentDate,
		mailboxId: threadMessage.mailboxId,
		isRead: threadMessage.isRead,
		isDeleted: threadMessage.isDeleted,
		hasStars: threadMessage.hasStars,
		hasAttachment: threadMessage.hasAttachment,
	},
});

/**
 * Handle MESSAGE_MOVE events.
 * Executes IMAP MOVE command and updates local state with new UID.
 *
 * A failing move retries on SQS redelivery until `receiveCount` reaches
 * {@link MESSAGE_MOVE_MAX_ATTEMPTS}, at which point
 * {@link resolveExhaustedMessageMoveFailure} asks IMAP where the message
 * actually is and settles the row into one terminal outcome (issue #655).
 * Before that, `syncStatus: failed` marked every attempt and nothing ever
 * settled the row, so an exhausted move sat `moving`/`failed` forever.
 */
export const handleMessageMove = async (
	event: MessageMoveEvent,
	log: Logger,
	receiveCount = 1,
): Promise<void> => {
	const {
		account: accountService,
		message: messageService,
		threadMessage: threadMessageService,
		mailbox: mailboxService,
		secrets,
	} = await getClient();

	const {
		accountId,
		messageId,
		sourceMailboxId,
		sourceMailboxPath,
		destinationMailboxPath,
		destinationMailboxId,
		uid,
	} = event;

	log.info(
		{
			event: event.type,
			accountId,
			messageId,
			from: sourceMailboxPath,
			to: destinationMailboxPath,
		},
		"Handling event",
	);

	const account = await accountService.get(accountId);
	if (!account) {
		throw new Error(`Account ${accountId} not found`);
	}

	if (isAccountDeleted(account, log)) {
		return;
	}

	const [message] = await messageService.get([messageId]);

	// The message row is already gone — some other reconciliation path deleted
	// it. The move is moot; ack without touching IMAP.
	if (!message) {
		log.warn(
			{ accountId, messageId },
			"Skipping MESSAGE_MOVE: message row no longer exists",
		);
		return;
	}

	// This move already settled — `updateUid` cleared `status: moving` once the
	// server confirmed it. A redelivery reaching here would MOVE a UID the
	// source no longer holds, fail, and on exhaustion read the source's honest
	// "gone" as grounds to reconcile away a row that is correct. There is no
	// marker to find missing (unlike FLAG_PUSH and PLACEMENT_MOVE_PUSH), so the
	// row's own pending marker is what stands in for one.
	if (!isPlacementUnsettled(message)) {
		log.info(
			{ accountId, messageId, uid: message.uid, status: message.status },
			"Skipping MESSAGE_MOVE: the move already settled against confirmed IMAP state",
		);
		return;
	}

	await withOAuthLifecycle(
		buildLifecycleDeps(secrets, accountService),
		account,
		log,
		async (credentials) => {
			// The source folder can be deleted between enqueue and this sync, leaving
			// a queued event pointing at a gone row. The lookup then throws
			// NotFoundError forever, and on the account's per-group FIFO that head
			// message stalls the whole pipeline (issues #287, #289, #290). A deleted
			// source mailbox makes the move moot: ack with a WARN.
			const mailbox = await mailboxService
				.get(accountId, sourceMailboxId)
				.catch((error: unknown) => {
					if (isNotFoundError(error)) return null;
					throw error;
				});
			if (!mailbox) {
				log.warn(
					{ accountId, messageId, mailboxId: sourceMailboxId },
					"Skipping MESSAGE_MOVE: source mailbox no longer exists (deleted)",
				);
				return;
			}

			// Cheap frugal skip (epic #1281 invariant 6): a mailbox already known
			// paused never even opens a connection. Optimization only — the
			// guardConnectionCursor openBox wrap below is the structural guarantee.
			if (isCursorRebuildNeeded(mailbox.cursorState)) {
				log.info(
					{ accountId, messageId, mailboxId: sourceMailboxId },
					"Mailbox cursor not normal; pausing outbound move this round",
				);
				return;
			}

			const scope = createConnectionScopeWithCredentials(account, credentials);

			await scope
				.getConnection()
				.then((rawConnection) => {
					// Guard at the openBox choke point (epic #1281 invariants 3 & 5):
					// a fresh mismatch trips the mailbox and throws once the SELECT
					// reveals it. The move stays applied locally either way.
					const connection = guardConnectionCursor(
						rawConnection,
						{ mailboxService },
						accountId,
						mailbox,
					);
					return moveThenResync(
						async () => {
							// Open source mailbox (not read-only)
							await connection.openBox(sourceMailboxPath, false);

							// Execute IMAP MOVE
							const result = await connection.moveMessages(
								[uid],
								destinationMailboxPath,
							);

							// Get new UID from COPYUID response. A server without UIDPLUS
							// answers a perfectly successful MOVE with no COPYUID entry,
							// so an empty map is UNCONFIRMED, never evidence the message
							// is gone: the destination is asked by Message-ID before any
							// verdict, exactly as `attemptMove` does. Marking the row
							// `failed` and returning (the behaviour issue #655 opens on)
							// left it `moving`/`failed` with no DLQ entry and no metric,
							// because a handler that returns never redelivers.
							const newUid =
								result.uidMap.get(uid) ??
								(message.messageIdHeader
									? await searchMailboxForHighestMessageIdUid(
											rawConnection,
											destinationMailboxPath,
											message.messageIdHeader,
										)
									: null);

							if (!newUid) {
								throw new Error(
									`Message move unconfirmed (no COPYUID entry, not found at ${destinationMailboxPath}) — retrying`,
								);
							}

							// Update message with new UID
							await messageService.updateUid(
								messageId,
								newUid,
								destinationMailboxId,
							);

							// Update ThreadMessage UID and mailboxId
							const threadMessage = await threadMessageService.findByMessageId(
								account.accountConfigId,
								messageId,
							);
							if (threadMessage) {
								const args = buildThreadMessageMoveUpdate(
									threadMessage,
									newUid,
									destinationMailboxId,
								);
								await threadMessageService.update(
									threadMessage.accountConfigId,
									threadMessage.threadMessageId,
									args.set,
									{ composites: args.composites },
								);
							}

							log.info(
								{
									messageId,
									oldUid: uid,
									newUid,
									destination: destinationMailboxPath,
								},
								"Message moved successfully",
							);
						},
						() =>
							emitMoveResync(emitEvent, {
								accountId,
								sourceMailboxId,
								destinationMailboxId,
							}),
					);
				})
				.catch(async (error: unknown) => {
					if (error instanceof MailboxCursorPausedError) {
						log.info(
							{
								accountId,
								messageId,
								mailboxId: sourceMailboxId,
								cursorState: error.state,
							},
							"Mailbox cursor not normal; pausing outbound move this round",
						);
						return;
					}

					const errorMessage =
						error instanceof Error ? error.message : String(error);

					// Handle TRYCREATE - destination doesn't exist
					if (errorMessage.includes("TRYCREATE")) {
						log.info(
							{ destinationMailboxPath },
							"Destination mailbox doesn't exist, creating",
						);
						const connection = await scope.getConnection();
						await connection.createMailbox(destinationMailboxPath);
						// Re-throw to let the event be retried against the folder just
						// created. Kept unconditional past the attempt budget: the
						// destination now exists, so the record is worth redriving from
						// the DLQ, and the terminal resolver has nothing to settle — it
						// would find the message exactly where it started.
						throw error;
					}

					if (receiveCount < MESSAGE_MOVE_MAX_ATTEMPTS) {
						// Transient move failure — expected (connections drop). No
						// alarm; queue redelivery retries, and `failed` marks the row
						// as unsettled meanwhile. It is not a terminal signal: only the
						// resolver below settles anything.
						await messageService.update(messageId, {
							syncStatus: MessageSyncStatus.failed,
						});
						throw error;
					}

					// Redelivery budget exhausted: resolve into exactly one of the two
					// terminal outcomes instead of dead-lettering with no diagnosis,
					// and never by inferring the server's state from our own failures.
					const { outcome } = await resolveExhaustedMessageMoveFailure(
						{ messageService, threadMessageService, log },
						{
							accountId,
							accountConfigId: account.accountConfigId,
							messageId,
							sourceMailboxId,
							uid,
							sourceMailboxPath,
							getConnection: scope.getConnection,
						},
					);

					if (outcome === "broken") {
						// Terminal and never re-thrown, so the handler-outcome series
						// records this record as a success. Counted here or it is
						// invisible.
						recordImapFailure("MESSAGE_MOVE_EXHAUSTED", "other");
						log.error(
							{ error: errorMessage },
							"Message move retry exhausted; message still exists at its source",
						);
					}

					// Both verdicts end in a row the server has contradicted, so this
					// move reconciles rather than waits (R2). RECONCILED, the local rows
					// are gone and whichever folder actually holds the message
					// re-projects it with the server's own UID. BROKEN, the row has just
					// been put back at the source the server confirmed, and the resync
					// is what carries any drift either folder has picked up since.
					await emitMoveResync(emitEvent, {
						accountId,
						sourceMailboxId,
						destinationMailboxId,
					});
					// Terminal — never re-thrown, so the caller acks either way.
				})
				.finally(() => scope.disconnect());
		},
	);
};
