import {
	AccountService,
	getClient,
	MailboxService,
	MessageService,
	type ThreadMessageItem,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import type { Logger } from "@remit/remit-logger-lambda";
import {
	guardConnectionCursor,
	isCursorRebuildNeeded,
	MailboxCursorPausedError,
} from "@remit/mailbox-service";
import {
	createKmsDataKeyProvider,
	createSecretsService,
} from "@remit/secrets-service";
import { env } from "expect-env";
import { isAccountDeleted } from "../account-check.js";
import { createConnectionScopeWithCredentials } from "../connection-scope.js";
import { emitEvent } from "../emit.js";
import type { MessageMoveEvent, SyncMessagesEvent } from "../events.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";

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

const client = getClient();
const dataKeyProvider = createKmsDataKeyProvider(env.KMS_KEY_ID);
const secrets = createSecretsService(dataKeyProvider);

const accountService = new AccountService({
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
const mailboxService = new MailboxService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});

/**
 * Handle MESSAGE_MOVE events.
 * Executes IMAP MOVE command and updates local state with new UID.
 */
export const handleMessageMove = async (
	event: MessageMoveEvent,
	log: Logger,
): Promise<void> => {
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

	await withOAuthLifecycle(
		buildLifecycleDeps(secrets, accountService),
		account,
		log,
		async (credentials) => {
			const mailbox = await mailboxService.get(accountId, sourceMailboxId);

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

							// Get new UID from COPYUID response
							const newUid = result.uidMap.get(uid);

							if (newUid) {
								// Update message with new UID
								await messageService.updateUid(
									messageId,
									newUid,
									destinationMailboxId,
								);

								// Update ThreadMessage UID and mailboxId
								const threadMessage =
									await threadMessageService.findByMessageId(
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
							} else {
								// Message may have been deleted on server
								log.error(
									{ messageId, uid },
									"Message not found in COPYUID response - may have been deleted",
								);
								await messageService.update(messageId, {
									syncStatus: MessageSyncStatus.failed,
								});
							}
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
						// Re-throw to let the event be retried
						throw error;
					}

					// Handle message not found on IMAP - already moved/deleted (idempotent)
					if (
						errorMessage.includes("not found") ||
						errorMessage.includes("NONEXISTENT")
					) {
						log.info(
							{ messageId, uid },
							"Message not found on IMAP, updating local state as synced",
						);
						await messageService.update(messageId, {
							status: MessageStatus.active,
							syncStatus: MessageSyncStatus.synced,
						});
						return;
					}

					// Mark as failed for other errors
					await messageService.update(messageId, {
						syncStatus: MessageSyncStatus.failed,
					});
					throw error;
				})
				.finally(() => scope.disconnect());
		},
	);
};
