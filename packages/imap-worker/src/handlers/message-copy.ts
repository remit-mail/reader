import { getClient } from "@remit/backend/client";
import type { IMessageRepository } from "@remit/data-ports";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import type { Logger } from "@remit/logger-lambda";
import { recordImapFailure } from "@remit/logger-lambda";
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

/**
 * Fallback when `MESSAGE_COPY_MAX_ATTEMPTS` is unset (local dev, unit tests).
 * Matches the `maxReceiveCount` the message queue's redrive policy uses
 * (`remit-message-mgmt`, `deploy/vps/queues.json`), same pattern as
 * `MESSAGE_MOVE_MAX_ATTEMPTS` and `PLACEMENT_MOVE_MAX_ATTEMPTS`.
 */
const DEFAULT_MESSAGE_COPY_MAX_ATTEMPTS = 3;

export const getMessageCopyMaxAttempts = (
	processEnv: NodeJS.ProcessEnv = process.env,
): number => {
	const raw = processEnv.MESSAGE_COPY_MAX_ATTEMPTS;
	if (!raw) return DEFAULT_MESSAGE_COPY_MAX_ATTEMPTS;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0
		? parsed
		: DEFAULT_MESSAGE_COPY_MAX_ATTEMPTS;
};

export const MESSAGE_COPY_MAX_ATTEMPTS = getMessageCopyMaxAttempts();

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
 * Probe the destination mailbox by the source row's RFC822 Message-ID header
 * when the COPYUID response names no uid — the fallback for servers without
 * UIDPLUS, which answer a perfectly successful COPY with no COPYUID entry.
 * Read-only (EXAMINE). Returns the first matching UID, or `null` when the
 * source row is gone, carries no Message-ID header, or nothing matched.
 *
 * The probe goes through the RAW connection: a `guardConnectionCursor` wrap
 * binds its checks to the ONE mailbox snapshot it was built with, so the
 * destination must never be opened through the source's guard (see
 * `confirmTrashMoveUid` in message-delete.ts).
 *
 * `sameMailbox` must skip the probe entirely: a copy onto its own source
 * succeeds server-side with an empty uidMap, and the probe would then open the
 * still-selected source (imapflow re-open idempotency) and match the SOURCE
 * message itself — settling the copy row on the source's own uid, two rows
 * owning one server message and the actual copy orphaned (review of #1102).
 * The enqueue path now rejects same-mailbox copies
 * (`MessageMoveService.copySettledMessage`); this guard covers events already
 * in flight when that landed.
 */
const probeDestinationByMessageId = async (
	rawConnection: IImapConnection,
	messageService: Pick<IMessageRepository, "get">,
	sourceMessageId: string,
	destinationMailboxPath: string,
	sameMailbox: boolean,
): Promise<number | null> => {
	if (sameMailbox) return null;
	const [sourceMessage] = await messageService.get([sourceMessageId]);
	if (!sourceMessage?.messageIdHeader) return null;
	return searchMailboxByMessageId(
		rawConnection,
		destinationMailboxPath,
		sourceMessage.messageIdHeader,
	);
};

/**
 * Handle MESSAGE_COPY events.
 * Executes IMAP COPY command and updates local state with new UID.
 *
 * A failing copy retries on SQS redelivery until `receiveCount` reaches
 * {@link MESSAGE_COPY_MAX_ATTEMPTS}, at which point it resolves into a terminal
 * outcome (issue #1270) — the row stays `failed` as the unsettled marker and
 * an alert is raised — instead of dead-lettering blindly. Until then the
 * handler is idempotent in the DB (deterministic `newMessageId`) but not on the
 * wire: a retry re-issues COPY unless the destination probe shows an earlier
 * attempt already landed the copy (see the pre-probe below).
 */
export const handleMessageCopy = async (
	event: MessageCopyEvent,
	log: Logger,
	receiveCount = 1,
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

			const scope = createConnectionScopeWithCredentials(account, credentials);

			// Same source and destination mailbox: the probe must never run (see
			// `probeDestinationByMessageId`). The enqueue path rejects this shape;
			// this also covers events already in flight from before that guard.
			const sameMailbox =
				sourceMailboxId === destinationMailboxId ||
				sourceMailboxPath === destinationMailboxPath;

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
					// A redelivery re-issues COPY by default, but an earlier attempt
					// may already have landed the copy its response never confirmed —
					// the connection can drop after the server executed COPY, which is
					// exactly the transient failure retries exist for. On redelivery the
					// destination is therefore asked FIRST: a match settles the row
					// without a second server-side COPY, which would otherwise
					// duplicate the message on the wire on every retry (review of
					// #1102). First delivery skips this — its COPY has not run yet.
					const probedUid =
						receiveCount > 1
							? await probeDestinationByMessageId(
									rawConnection,
									messageService,
									sourceMessageId,
									destinationMailboxPath,
									sameMailbox,
								)
							: null;

					let newUid = probedUid;
					if (!newUid) {
						// Open source mailbox (read-only is fine for COPY)
						await connection.openBox(sourceMailboxPath, true);

						// Execute IMAP COPY
						const result = await connection.copyMessages(
							[uid],
							destinationMailboxPath,
						);

						// Get new UID from COPYUID response. UIDPLUS is an extension: a
						// server without it answers a perfectly successful COPY with no
						// COPYUID entry, so an absent entry is UNCONFIRMED, never evidence
						// the copy failed. The destination is probed by Message-ID before
						// any verdict, exactly as `handleMessageMove` does (issue #1097; the
						// same shape #979 took out of `message-delete`). Marking the row
						// `failed` and returning — the old behaviour — left it `uid: 0`,
						// `status: moving`, `syncStatus: failed` permanently, with no retry,
						// no DLQ entry and no metric, because a handler that returns never
						// redelivers.
						newUid =
							result.uidMap.get(uid) ??
							(await probeDestinationByMessageId(
								rawConnection,
								messageService,
								sourceMessageId,
								destinationMailboxPath,
								sameMailbox,
							));
					}

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
						// No COPYUID entry and no probe match: the copy is UNCONFIRMED,
						// not proven failed. Throw so the event redelivers — the generic
						// catch below marks the row `failed` as the unsettled marker
						// while the retry is pending. Wording must avoid "not found" and
						// "NONEXISTENT", which that catch reads as a server-side delete —
						// and never interpolates the destination path: a mailbox literally
						// named "not found" would be misread the same way (review of #1102).
						throw new Error(
							"Message copy unconfirmed (no COPYUID entry, no match by Message-ID in the destination mailbox) — retrying",
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
						// Re-throw to let the event be retried against the folder just
						// created. Kept unconditional past the attempt budget: the
						// destination now exists, so the record is worth redriving from
						// the DLQ, and there is nothing to settle terminally — the copy
						// has not been attempted against the folder yet.
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
					if (receiveCount < MESSAGE_COPY_MAX_ATTEMPTS) throw error;

					// Redelivery budget exhausted. Unlike MESSAGE_MOVE there is no
					// honest question left to ask the server: an unconfirmable copy (no
					// COPYUID entry and no Message-ID to probe with — or a server whose
					// SEARCH cannot) is precisely one the probes cannot see, so there is
					// no terminal resolver to run. Local state stays exactly as it stands
					// (`status: moving`, `syncStatus: failed` — the unsettled marker)
					// for operator investigation, and the record acks instead of
					// dead-lettering blindly (issue #1270). Counted here or it is
					// invisible.
					recordImapFailure("MESSAGE_COPY_EXHAUSTED", "other");
					log.error(
						{
							alert: "message_copy_failed",
							accountId,
							sourceMessageId,
							newMessageId,
							receiveCount,
							error: errorMessage,
						},
						"Message copy could not be confirmed or pushed to IMAP after retry exhaustion; local state left for operator investigation",
					);
					// Terminal — never re-thrown, so the caller acks either way.
				})
				.finally(() => scope.disconnect());
		},
	);
};
