import { getClient } from "@remit/backend/client";
import type { Logger } from "@remit/logger-lambda";
import {
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

	await withOAuthLifecycle(
		buildLifecycleDeps(secrets, accountService),
		account,
		log,
		async (credentials) => {
			const mailbox = await mailboxService.get(accountId, trashMailboxId);

			// Cheap frugal skip (epic #1281 invariant 6): a mailbox already known
			// paused never even opens a connection. Optimization only — the
			// guardConnectionCursor openBox wrap below is the structural guarantee.
			if (isCursorRebuildNeeded(mailbox.cursorState)) {
				log.info(
					{ accountId, mailboxId: trashMailboxId },
					"Mailbox cursor not normal; pausing empty-trash this round",
				);
				return;
			}

			const scope = createConnectionScopeWithCredentials(account, credentials);

			await scope
				.getConnection()
				.then(async (rawConnection) => {
					// Guard at the openBox choke point (epic #1281 invariants 3 & 5):
					// a fresh mismatch trips the mailbox and throws once the SELECT
					// reveals it. Local rows stay marked for deletion and are picked
					// up once the mailbox returns to normal.
					const connection = guardConnectionCursor(
						rawConnection,
						{ mailboxService },
						accountId,
						mailbox,
					);
					await connection.openBox(trashMailboxPath, false);

					// Search for all messages in Trash
					const uids = await connection.search(["ALL"]);

					if (uids.length > 0) {
						// Delete all messages on IMAP
						await connection.deleteMessages(uids);
						log.info(
							{ count: uids.length },
							"Deleted messages from IMAP trash",
						);
					}

					// Delete all local messages in trash
					const localMessages =
						await messageService.listAllByMailbox(trashMailboxId);

					for (const message of localMessages) {
						// Delete the Message entity
						await messageService.delete(message.messageId);

						// Delete the ThreadMessage entity
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

					log.info(
						{ accountId, deletedCount: localMessages.length },
						"Trash emptied successfully",
					);
				})
				.catch((error: unknown) => {
					if (error instanceof MailboxCursorPausedError) {
						log.info(
							{
								accountId,
								mailboxId: trashMailboxId,
								cursorState: error.state,
							},
							"Mailbox cursor not normal; pausing empty-trash this round",
						);
						return;
					}
					throw error;
				})
				.finally(() => scope.disconnect());
		},
	);
};
