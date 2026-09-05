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
import { restoreSourcePlacement } from "./restore-source-placement.js";

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
 * Which side of a paused mutation the server actually holds the message on.
 * `gone` is an answer both folders gave; `unprobeable` is the row that carries
 * no Message-ID header, where the server was never asked and its silence says
 * nothing.
 */
export type PausedPlacement =
	| { kind: "at-source" }
	| { kind: "at-destination"; uid: number }
	| { kind: "gone" }
	| { kind: "unprobeable" };

/**
 * Ask the server, by Message-ID, which folder holds a message whose mutation a
 * paused cursor interrupted (issue #1203).
 *
 * Reached only on a redelivery, where "the command never left" has stopped
 * being provable: the earlier attempt's tagged OK can be lost with the
 * connection, so restoring the source pair on that assumption would write a
 * settled placement naming a folder the server has already moved the mail out
 * of. `message-copy.ts` asks the same question for the same reason.
 *
 * The SOURCE is asked first and a hit ends it, the gate `confirmTrashMoveUid`
 * documents (#1122): where the mutation never ran, every hit at the destination
 * is an older copy of the same Message-ID — a sieve `fileinto` + `keep`, a
 * multi-label store, a resend — that `deriveMessageId` folds into this one local
 * row, and binding to it hands a later delete somebody else's uid.
 *
 * Identity, not position, is what makes this askable at all: a paused cursor
 * means the source's UIDVALIDITY has moved, so every stored uid for it names
 * something else, but a SEARCH by header is independent of the axis and answers
 * the same question the cursor rebuild itself matches rows by. For that reason
 * the caller passes the UNGUARDED connection — a `guardConnectionCursor` wrap
 * refuses to open the mailbox at all, and it is bound to the source's snapshot
 * anyway, so opening the destination through it would trip that mailbox too.
 */
export const probePausedPlacement = async (
	connection: IImapConnection,
	input: {
		messageIdHeader: string | undefined;
		sourceMailboxPath: string;
		destinationMailboxPath: string | undefined;
	},
): Promise<PausedPlacement> => {
	const { messageIdHeader, sourceMailboxPath, destinationMailboxPath } = input;
	if (!messageIdHeader) return { kind: "unprobeable" };

	const atSource = await searchMailboxForHighestMessageIdUid(
		connection,
		sourceMailboxPath,
		messageIdHeader,
	);
	if (atSource !== null) return { kind: "at-source" };

	if (!destinationMailboxPath) return { kind: "gone" };

	const atDestination = await searchMailboxForHighestMessageIdUid(
		connection,
		destinationMailboxPath,
		messageIdHeader,
	);
	return atDestination === null
		? { kind: "gone" }
		: { kind: "at-destination", uid: atDestination };
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

export interface MessageMoveDeps {
	getClient: typeof getClient;
	buildLifecycleDeps: typeof buildLifecycleDeps;
	withOAuthLifecycle: typeof withOAuthLifecycle;
	createConnectionScope: typeof createConnectionScopeWithCredentials;
	emitEvent: typeof emitEvent;
}

const defaultDeps: MessageMoveDeps = {
	getClient,
	buildLifecycleDeps,
	withOAuthLifecycle,
	createConnectionScope: createConnectionScopeWithCredentials,
	emitEvent,
};

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
	deps: MessageMoveDeps = defaultDeps,
): Promise<void> => {
	const {
		getClient,
		buildLifecycleDeps,
		withOAuthLifecycle,
		createConnectionScope: createConnectionScopeWithCredentials,
		emitEvent,
	} = deps;

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

			const settleMoved = async (newUid: number): Promise<void> => {
				await messageService.updateUid(messageId, newUid, destinationMailboxId);

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
			};

			const handBackToSource = (): Promise<void> =>
				restoreSourcePlacement(
					{ messageService, threadMessageService },
					{
						accountConfigId: account.accountConfigId,
						messageId,
						sourceMailboxId,
						uid,
						syncStatus: MessageSyncStatus.synced,
					},
				);

			const scope = createConnectionScopeWithCredentials(account, credentials);

			// The terminal resolver opens the source itself, and its answer now
			// WRITES a placement, so it has to reach IMAP through the same
			// UIDVALIDITY choke point every other outbound operation does. An
			// unguarded probe on a folder that was deleted and recreated finds
			// whatever the server has renumbered onto this uid, reads it as "still
			// at source", and binds the row to a stranger the next permanent delete
			// would expunge.
			const getGuardedConnection = async (): Promise<IImapConnection> =>
				guardConnectionCursor(
					await scope.getConnection(),
					{ mailboxService },
					accountId,
					mailbox,
				);

			// A paused cursor is never acked on the optimistic row: `updateForMove`
			// has pointed it at the destination while `uid` still names the source,
			// and that pair strands the row for good — the cursor rebuild matches
			// rows by `(accountConfigId, mailboxId)`, so a row naming the
			// destination is in neither folder's set, and nothing re-enqueues a
			// MESSAGE_MOVE (issue #1203).
			//
			// This move therefore reconciles rather than waits (R2,
			// docs/architecture/imap-mutations.md): the row is settled onto
			// whichever pair the server can be shown to hold, and the resync below
			// plus the source's own cursor rebuild are its repair path.
			//
			// A first delivery has provably issued no MOVE — every paused exit is
			// reached before `moveMessages`, one without a connection and one from
			// the openBox guard — so putting the row back is an undo of this
			// product's own write, not a claim about the server. A redelivery has
			// not: the earlier attempt's tagged OK can be lost with the connection,
			// and restoring the source pair on that assumption writes a settled
			// placement onto a folder the server has already moved the mail out of.
			// It asks instead.
			const settlePausedMove = async (): Promise<void> => {
				const placement =
					receiveCount === 1
						? ({ kind: "at-source" } as const)
						: await probePausedPlacement(await scope.getConnection(), {
								messageIdHeader: message.messageIdHeader,
								sourceMailboxPath,
								destinationMailboxPath,
							});

				if (placement.kind === "at-destination") {
					await settleMoved(placement.uid);
				} else {
					// `gone` and `unprobeable` land here with the rest: the source pair
					// is the set the rebuild walks, and a row it cannot match against a
					// fresh envelope snapshot is the one thing it reconciles away.
					await handBackToSource();
				}

				await emitMoveResync(emitEvent, {
					accountId,
					sourceMailboxId,
					destinationMailboxId,
				});
			};

			// Cheap frugal skip (epic #1281 invariant 6): a mailbox already known
			// paused never opens a connection on a first delivery. Optimization
			// only — the guardConnectionCursor openBox wrap below is the structural
			// guarantee.
			if (isCursorRebuildNeeded(mailbox.cursorState)) {
				log.info(
					{ accountId, messageId, mailboxId: sourceMailboxId },
					"Mailbox cursor not normal; pausing outbound move this round and settling the row against the server",
				);
				await settlePausedMove().finally(() => scope.disconnect());
				return;
			}

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

							await settleMoved(newUid);
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
							"Mailbox cursor not normal; pausing outbound move this round and settling the row against the server",
						);
						await settlePausedMove();
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
					const settled = await resolveExhaustedMessageMoveFailure(
						{ messageService, threadMessageService, log },
						{
							accountId,
							accountConfigId: account.accountConfigId,
							messageId,
							sourceMailboxId,
							uid,
							sourceMailboxPath,
							getConnection: getGuardedConnection,
						},
					).catch(async (settleError: unknown) => {
						// The guarded probe found a mailbox whose UIDVALIDITY has moved.
						// Nothing may be settled off a uid on a dead axis, and the pause
						// is the routine skip `guardMailboxCursor` documents, not a fault
						// to re-throw out of this catch. The row is still settled, on the
						// identity axis instead: `settlePausedMove` asks by Message-ID,
						// which a UIDVALIDITY change does not invalidate.
						if (settleError instanceof MailboxCursorPausedError) {
							log.info(
								{
									accountId,
									messageId,
									mailboxId: sourceMailboxId,
									cursorState: settleError.state,
								},
								"Mailbox cursor not normal; settling the exhausted move against the server by Message-ID",
							);
							await settlePausedMove();
							return null;
						}
						throw settleError;
					});

					if (!settled) return;

					if (settled.outcome === "broken") {
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
