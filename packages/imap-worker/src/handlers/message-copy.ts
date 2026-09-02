import { getClient } from "@remit/backend/client";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import type { Logger } from "@remit/logger-lambda";
import {
	guardConnectionCursor,
	type IImapConnection,
	isCursorRebuildNeeded,
	MailboxCursorPausedError,
} from "@remit/mailbox-service";
import { isAccountDeleted } from "../account-check.js";
import { createConnectionScopeWithCredentials } from "../connection-scope.js";
import type { MessageCopyEvent } from "../events.js";
import { isNotFoundError } from "../is-not-found.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";
import { searchMailboxByMessageId } from "./message-move.js";

export interface MessageCopyDeps {
	getClient: typeof getClient;
	buildLifecycleDeps: typeof buildLifecycleDeps;
	withOAuthLifecycle: typeof withOAuthLifecycle;
	createConnectionScope: typeof createConnectionScopeWithCredentials;
}

const defaultDeps: MessageCopyDeps = {
	getClient,
	buildLifecycleDeps,
	withOAuthLifecycle,
	createConnectionScope: createConnectionScopeWithCredentials,
};

/**
 * Handle MESSAGE_COPY events.
 * Executes IMAP COPY command and updates local state with new UID.
 */
export const handleMessageCopy = async (
	event: MessageCopyEvent,
	log: Logger,
	deps: MessageCopyDeps = defaultDeps,
): Promise<void> => {
	const {
		getClient,
		buildLifecycleDeps,
		withOAuthLifecycle,
		createConnectionScope: createConnectionScopeWithCredentials,
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
		sourceMessageId,
		newMessageId,
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
			sourceMessageId,
			newMessageId,
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
			// The source folder can be deleted between enqueue and this sync, leaving
			// a queued event pointing at a gone row. The lookup then throws
			// NotFoundError forever, and on the account's per-group FIFO that head
			// message stalls the whole pipeline (issues #287, #289, #290). A deleted
			// source mailbox makes the copy moot: ack with a WARN.
			const mailbox = await mailboxService
				.get(accountId, sourceMailboxId)
				.catch((error: unknown) => {
					if (isNotFoundError(error)) return null;
					throw error;
				});
			if (!mailbox) {
				log.warn(
					{ accountId, sourceMessageId, mailboxId: sourceMailboxId },
					"Skipping MESSAGE_COPY: source mailbox no longer exists (deleted)",
				);
				return;
			}

			// Cheap frugal skip (epic #1281 invariant 6): a mailbox already known
			// paused never even opens a connection. Optimization only — the
			// guardConnectionCursor openBox wrap below is the structural guarantee.
			if (isCursorRebuildNeeded(mailbox.cursorState)) {
				log.info(
					{ accountId, sourceMessageId, mailboxId: sourceMailboxId },
					"Mailbox cursor not normal; pausing outbound copy this round",
				);
				return;
			}

			// The copy row carries the source's Message-ID header, so the
			// destination can be asked whether the COPY landed. A row that is gone,
			// or one that never carried the header, has nothing to ask with.
			const probeDestinationUid = async (
				connection: IImapConnection,
			): Promise<number | null> => {
				const [copy] = await messageService.get([newMessageId]);
				if (!copy?.messageIdHeader) return null;
				return searchMailboxByMessageId(
					connection,
					destinationMailboxPath,
					copy.messageIdHeader,
				);
			};

			const scope = createConnectionScopeWithCredentials(account, credentials);

			await scope
				.getConnection()
				.then(async (rawConnection) => {
					// Guard at the openBox choke point (epic #1281 invariants 3 & 5):
					// a fresh mismatch trips the mailbox and throws once the SELECT
					// reveals it.
					const connection = guardConnectionCursor(
						rawConnection,
						{ mailboxService },
						accountId,
						mailbox,
					);
					// Open source mailbox (read-only is fine for COPY)
					await connection.openBox(sourceMailboxPath, true);

					// Execute IMAP COPY
					const result = await connection.copyMessages(
						[uid],
						destinationMailboxPath,
					);

					// Get new UID from COPYUID response. A server without UIDPLUS
					// answers a perfectly successful COPY with no COPYUID entry, so an
					// empty map is UNCONFIRMED, never evidence the server matched
					// nothing: the destination is asked by Message-ID before any
					// verdict, exactly as `message-move.ts` does (#912, #979). The
					// probe uses the unguarded handle because a `guardConnectionCursor`
					// wrap is bound to the SOURCE mailbox snapshot alone.
					const newUid =
						result.uidMap.get(uid) ??
						(await probeDestinationUid(rawConnection));

					if (newUid) {
						// Update the new message with the actual UID
						await messageService.updateUid(
							newMessageId,
							newUid,
							destinationMailboxId,
						);

						// Update message status to active
						await messageService.update(newMessageId, {
							status: MessageStatus.active,
							syncStatus: MessageSyncStatus.synced,
						});

						// Update ThreadMessage UID
						const threadMessage = await threadMessageService.findByMessageId(
							account.accountConfigId,
							newMessageId,
						);
						if (threadMessage) {
							await threadMessageService.update(
								threadMessage.accountConfigId,
								threadMessage.threadMessageId,
								{ uid: newUid },
								{
									composites: {
										sentDate: threadMessage.sentDate,
										mailboxId: threadMessage.mailboxId,
										isRead: threadMessage.isRead,
										isDeleted: threadMessage.isDeleted,
										hasStars: threadMessage.hasStars,
										hasAttachment: threadMessage.hasAttachment,
									},
								},
							);
						}

						log.info(
							{
								sourceMessageId,
								newMessageId,
								oldUid: uid,
								newUid,
								destination: destinationMailboxPath,
							},
							"Message copied successfully",
						);
					} else {
						// The copy is nowhere: it did not land. Thrown rather than
						// recorded as a `failed` return, because a handler that returns
						// is acked — no redelivery, no dead letter, no metric — and the
						// row then sits at `uid: 0`/`moving` with no repair path, since a
						// later sync of the destination resolves the server's copy to the
						// SOURCE messageId and the `holdsCopyOf` guard declines it.
						throw new Error(
							`Message copy unconfirmed (no COPYUID entry, absent from ${destinationMailboxPath}) - retrying`,
						);
					}
				})
				.catch(async (error: unknown) => {
					if (error instanceof MailboxCursorPausedError) {
						log.info(
							{
								accountId,
								sourceMessageId,
								mailboxId: sourceMailboxId,
								cursorState: error.state,
							},
							"Mailbox cursor not normal; pausing outbound copy this round",
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

					// Handle source message not found on IMAP - already deleted (fail the copy)
					if (
						errorMessage.includes("not found") ||
						errorMessage.includes("NONEXISTENT")
					) {
						log.info(
							{ sourceMessageId, uid },
							"Source message not found on IMAP, marking copy as failed",
						);
						await messageService.update(newMessageId, {
							status: MessageStatus.deleted,
							syncStatus: MessageSyncStatus.failed,
						});
						return;
					}

					// Mark as failed for other errors
					await messageService.update(newMessageId, {
						syncStatus: MessageSyncStatus.failed,
					});
					throw error;
				})
				.finally(() => scope.disconnect());
		},
	);
};
