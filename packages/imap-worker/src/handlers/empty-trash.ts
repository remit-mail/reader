import { getClient } from "@remit/backend/client";
import type { MessageItem } from "@remit/data-ports";
import { trashMailboxAt } from "@remit/data-ports/folder-role";
import { isCurrentSchemaVersion } from "@remit/data-ports/mutation-events";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import type { Logger } from "@remit/logger-lambda";
import {
	guardConnectionCursor,
	isCursorRebuildNeeded,
	MailboxCursorPausedError,
} from "@remit/mailbox-service";
import { isAccountDeleted } from "../account-check.js";
import { createConnectionScopeWithCredentials } from "../connection-scope.js";
import type { EmptyTrashEvent } from "../events.js";
import { isNotFoundError } from "../is-not-found.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";
import { buildThreadMessageUndelete } from "./thread-message-rows.js";

export interface EmptyTrashDeps {
	getClient: typeof getClient;
	buildLifecycleDeps: typeof buildLifecycleDeps;
	withOAuthLifecycle: typeof withOAuthLifecycle;
	createConnectionScope: typeof createConnectionScopeWithCredentials;
}

const defaultDeps: EmptyTrashDeps = {
	getClient,
	buildLifecycleDeps,
	withOAuthLifecycle,
	createConnectionScope: createConnectionScopeWithCredentials,
};

/**
 * Handle EMPTY_TRASH events.
 * Permanently deletes all messages in the Trash mailbox.
 *
 * The only unrecoverable mutation reader issues, so the folder's identity is
 * confirmed here, on the connection that does the expunging: the role still
 * names this mailbox on confirmed evidence, and the UIDVALIDITY the SELECT
 * serves still matches the one the user consented to. Every refusal reverts
 * the optimistic local marks and acks — a throw would stall the account's FIFO
 * group behind an event no retry can fix (issues #287, #289, #290).
 */
export const handleEmptyTrash = async (
	event: EmptyTrashEvent,
	log: Logger,
	deps: EmptyTrashDeps = defaultDeps,
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
		mailboxSpecialUse: mailboxSpecialUseService,
		secrets,
	} = await getClient();

	const { accountId, trashMailboxId, trashMailboxPath } = event;

	log.info(
		{ event: event.type, accountId, trashMailboxPath },
		"Handling event",
	);

	const account = await accountService.get(accountId);
	if (!account) {
		throw new Error(`Account ${accountId} not found`);
	}

	if (isAccountDeleted(account, log)) {
		return;
	}

	// `emptyTrash` marks every row in the folder `deleting` + `isDeleted` before
	// enqueueing, so any row this expunge does not carry through is hidden from
	// every listing with nothing else to unhide it: no sync clears it, a repeat
	// Empty Trash skips it again, and listings filter `isDeleted`. Handing it
	// back is right whichever way it got left behind — mail already gone from
	// the server becomes visible and the next cursor rebuild reconciles it, and
	// an unsettled move is rewritten by its own MESSAGE_DELETE. Not `failed`:
	// the mail is intact, and saying otherwise about a whole folder is a lie.
	const handBackMarkedRows = async (
		rows: readonly { messageId: string; status: MessageItem["status"] }[],
	): Promise<number> => {
		let revertedCount = 0;
		for (const message of rows) {
			if (message.status !== MessageStatus.deleting) continue;

			// Empty Trash only flips `isDeleted` on the listing rows; a permanent
			// delete removes them up front. So a `deleting` row with no listing row
			// was marked by some other in-flight operation, and reverting the
			// Message under it would resurrect what that one is about to remove.
			const threadMessages = await threadMessageService.findAllByMessageId(
				account.accountConfigId,
				message.messageId,
			);
			if (threadMessages.length === 0) continue;

			await messageService.update(message.messageId, {
				status: MessageStatus.active,
				syncStatus: MessageSyncStatus.synced,
			});
			for (const threadMessage of threadMessages) {
				const args = buildThreadMessageUndelete(threadMessage);
				await threadMessageService.update(
					threadMessage.accountConfigId,
					threadMessage.threadMessageId,
					args.set,
					{ composites: args.composites },
				);
			}
			revertedCount += 1;
		}
		return revertedCount;
	};

	const abandonEmptyTrash = async (
		reason: string,
		alert: string,
		context: Record<string, unknown> = {},
	): Promise<void> => {
		log.error(
			{ alert, accountId, trashMailboxId, trashMailboxPath, ...context },
			reason,
		);
		await handBackMarkedRows(
			await messageService.listAllByMailbox(trashMailboxId),
		);
	};

	if (!isCurrentSchemaVersion(event.schemaVersion)) {
		await abandonEmptyTrash(
			"Refused to empty trash: event was minted under an unknown contract",
			"empty_trash_unknown_schema_version",
			{ schemaVersion: event.schemaVersion },
		);
		return;
	}

	// The role can be re-appointed between consent and this run, and a queued
	// event then expunges the folder the user just stopped using as Trash.
	// Confirmed evidence only: what the user appointed, or what the server
	// flagged.
	const resolution = await mailboxSpecialUseService.resolveTrashRole(accountId);
	const trashGate = trashMailboxAt(resolution, "confirmed");
	if (!trashGate.allowed || trashGate.mailbox.mailboxId !== trashMailboxId) {
		await abandonEmptyTrash(
			"Refused to empty trash: this account's Trash is no longer that folder",
			"empty_trash_role_moved",
			{
				resolvedKind: resolution.kind,
				resolvedMailboxId: trashGate.allowed
					? trashGate.mailbox.mailboxId
					: undefined,
			},
		);
		return;
	}

	await withOAuthLifecycle(
		buildLifecycleDeps(secrets, accountService),
		account,
		log,
		async (credentials) => {
			// The Trash folder can be deleted between enqueue and this sync, leaving a
			// queued event pointing at a gone row. The lookup then throws
			// NotFoundError forever, and on the account's per-group FIFO that head
			// message stalls the whole pipeline (issues #287, #289, #290). A deleted
			// Trash makes the empty moot: ack with a WARN.
			const mailbox = await mailboxService
				.get(accountId, trashMailboxId)
				.catch((error: unknown) => {
					if (isNotFoundError(error)) return null;
					throw error;
				});
			if (!mailbox) {
				log.warn(
					{ accountId, mailboxId: trashMailboxId },
					"Skipping EMPTY_TRASH: mailbox no longer exists (deleted)",
				);
				return;
			}

			// A paused cursor is not a wait here: this return acks the event and
			// nothing re-issues it, so the marks have to come back or the folder
			// stays hidden forever. The user retries.
			if (isCursorRebuildNeeded(mailbox.cursorState)) {
				await abandonEmptyTrash(
					"Abandoned empty trash: mailbox cursor is not normal",
					"empty_trash_cursor_paused",
					{ cursorState: mailbox.cursorState },
				);
				return;
			}

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
					const boxStatus = await connection.openBox(trashMailboxPath, false);

					// The path is not the folder. A third-party client that renames
					// Trash and creates a fresh one leaves this event pointing at a
					// path now served by a folder the user never consented to empty;
					// UIDVALIDITY is what tells them apart (RFC 9051 2.3.1.1).
					if (boxStatus.uidvalidity !== event.trashUidValidity) {
						await abandonEmptyTrash(
							"Refused to empty trash: the folder at this path is not the one the user emptied",
							"empty_trash_uidvalidity_mismatch",
							{
								servedUidValidity: boxStatus.uidvalidity,
								consentedUidValidity: event.trashUidValidity,
							},
						);
						return;
					}

					const uids = await connection.search(["ALL"]);

					if (uids.length > 0) {
						await connection.deleteMessages(uids);
						log.info(
							{ count: uids.length },
							"Deleted messages from IMAP trash",
						);
					}

					// Local cleanup follows the expunge, uid by uid. What was expunged
					// is a fact this connection observed, and only those rows go.
					const expunged = new Set(uids);
					const localMessages =
						await messageService.listAllByMailbox(trashMailboxId);
					let deletedCount = 0;

					for (const message of localMessages) {
						if (!expunged.has(message.uid)) continue;
						deletedCount += 1;

						await messageService.delete(message.messageId);

						const threadMessage = await threadMessageService.findByMessageId(
							account.accountConfigId,
							message.messageId,
						);
						if (threadMessage) {
							await threadMessageService.delete(
								threadMessage.accountConfigId,
								threadMessage.threadMessageId,
							);
						}
					}

					// Everything the SEARCH did not name is still marked for a deletion
					// that will never come: mail another client already emptied, mail
					// that reached Trash after the SEARCH, or a redelivery finishing a
					// partial sweep. All three must come back rather than sit invisible.
					const revertedCount = await handBackMarkedRows(
						localMessages.filter((message) => !expunged.has(message.uid)),
					);

					log.info(
						{ accountId, deletedCount, revertedCount },
						"Trash emptied successfully",
					);
				})
				.catch(async (error: unknown) => {
					if (error instanceof MailboxCursorPausedError) {
						await abandonEmptyTrash(
							"Abandoned empty trash: mailbox cursor is not normal",
							"empty_trash_cursor_paused",
							{ cursorState: error.state },
						);
						return;
					}
					throw error;
				})
				.finally(() => scope.disconnect());
		},
	);
};
