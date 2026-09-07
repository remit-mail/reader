import { getClient } from "@remit/backend/client";
import type { MessageItem } from "@remit/data-ports";
import { isNotFoundError } from "@remit/data-ports/errors";
import { trashMailboxAt } from "@remit/data-ports/folder-role";
import { isCurrentSchemaVersion } from "@remit/data-ports/mutation-events";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import type { Logger } from "@remit/logger-lambda";
import {
	buildThreadMessageUndelete,
	carriesForeignUid,
	guardConnectionCursor,
	isCursorRebuildNeeded,
	MailboxCursorPausedError,
} from "@remit/mailbox-service";
import { isAccountDeleted } from "../account-check.js";
import { createConnectionScopeWithCredentials } from "../connection-scope.js";
import type { EmptyTrashEvent } from "../events.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";

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
		rows: readonly Pick<
			MessageItem,
			"messageId" | "status" | "mailboxId" | "uid"
		>[],
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

			// The hand-back is a transition off the row as this sweep read it
			// (imap-mutations R3), because the snapshot it walks holds nothing:
			// between the listing and here another lane can settle the row onto a
			// placement of its own, and writing `active` + `synced` over that would
			// declare a mutation settled that nobody confirmed.
			const restored = await messageService.transitionPlacement(
				message.messageId,
				{
					status: MessageStatus.deleting,
					mailboxId: message.mailboxId,
					uid: message.uid,
				},
				{
					status: MessageStatus.active,
					syncStatus: MessageSyncStatus.synced,
				},
			);
			if (!restored) {
				log.info(
					{ accountId, messageId: message.messageId },
					"Empty Trash left a row alone: its placement changed after the sweep read it",
				);
				continue;
			}
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

					// One read, before the expunge, decides both what is destroyed on
					// the server and what is removed locally — so the two sets are the
					// same set by construction and no message can be expunged that the
					// sweep then declines to remove (issue #1230). Reading afterwards
					// put the exclusion downstream of the destruction: a refused row
					// had already lost its server copy, could not be refused into
					// existence again, and nothing routine repaired it.
					//
					// Reconciles, never waits (imap-mutations R2). A row whose move
					// into Trash has not settled names this folder while still
					// carrying the SOURCE folder's uid, so matching it against the
					// expunge answers for whatever Trash held at that uid — another
					// message, deleted here in both its rows. Waiting is not open to
					// this handler the way it is to the API-side mutators: a move on
					// this account's own FIFO group cannot run until this returns, so
					// the ceiling would be spent to reach the same answer. It buys
					// nothing against the other lane either — PLACEMENT_MOVE_PUSH
					// rides a standard queue with no group at all
					// (`deploy/vps/queues.json`), so it is ordered against nothing
					// here and can settle a row mid-sweep. That is why the writes
					// below are transitions rather than snapshot writes (R3).
					//
					// `carriesForeignUid`, not the placement binding: the binding reads
					// `status`, and `status` is exactly what an operation marking this
					// folder overwrites. This is the same predicate `emptyTrash`
					// applies before it marks anything — one gate, one answer, now
					// asked once and honoured on both sides of the expunge.
					const localMessages =
						await messageService.listAllByMailbox(trashMailboxId);
					const refusedUids = new Set(
						localMessages
							.filter((message) => carriesForeignUid(message))
							.map((message) => message.uid),
					);

					const uids = (await connection.search(["ALL"])).filter(
						(uid) => !refusedUids.has(uid),
					);

					if (uids.length > 0) {
						await connection.deleteMessages(uids);
						log.info(
							{ count: uids.length, refused: refusedUids.size },
							"Deleted messages from IMAP trash",
						);
					}

					// What was expunged is a fact this connection observed, and only
					// those rows go.
					const expunged = new Set(uids);
					const swept = localMessages.filter(
						(message) =>
							!carriesForeignUid(message) && expunged.has(message.uid),
					);
					const sweptIds = new Set(swept.map((message) => message.messageId));
					const deletedCount = swept.length;

					for (const message of swept) {
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

					// Everything this sweep did not carry through is still marked for a
					// deletion that will never come: mail another client already
					// emptied, mail that reached Trash after the SEARCH, a redelivery
					// finishing a partial sweep, and a row whose uid the sweep would
					// not bind. All of them must come back rather than sit invisible —
					// the last one especially, since nothing else is coming to clear
					// its mark, and a row hidden in a folder it never left is worse
					// than one the next sync re-projects.
					const revertedCount = await handBackMarkedRows(
						localMessages.filter((message) => !sweptIds.has(message.messageId)),
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
