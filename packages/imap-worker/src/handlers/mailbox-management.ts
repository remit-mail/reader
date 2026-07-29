import { getClient } from "@remit/backend/client";
import { MailboxSyncStatus } from "@remit/domain-enums";
import type { Logger } from "@remit/logger-lambda";
import { MailboxManagementService } from "@remit/mailbox-service";
import { isAccountDeleted } from "../account-check.js";
import { createConnectionScopeWithCredentials } from "../connection-scope.js";
import type {
	MailboxCreateEvent,
	MailboxDeleteEvent,
	MailboxManagementEvent,
	MailboxRenameEvent,
} from "../events.js";
import { isNotFoundError } from "../is-not-found.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";

export interface MailboxManagementDeps {
	getClient: typeof getClient;
	buildLifecycleDeps: typeof buildLifecycleDeps;
	withOAuthLifecycle: typeof withOAuthLifecycle;
	createConnectionScope: typeof createConnectionScopeWithCredentials;
}

const defaultDeps: MailboxManagementDeps = {
	getClient,
	buildLifecycleDeps,
	withOAuthLifecycle,
	createConnectionScope: createConnectionScopeWithCredentials,
};

const stringField = (value: unknown, key: string): string => {
	if (!(value instanceof Object)) return "";
	const field = Reflect.get(value, key);
	return typeof field === "string" ? field : "";
};

/**
 * Read a tagged-NO outcome out of an IMAP failure.
 *
 * The two outcomes below are each a folder operation finding the server already
 * in the state it was asked for — the operation having happened, not failing.
 * Reading them as failures marks the row `failed` and rethrows, and since folder
 * management shares the account's per-account FIFO group with mailbox sync, that
 * un-acked rethrow holds back every later sync for the account.
 *
 * Both places the server can say so are read. `message` carries it when the
 * client raises the error itself; RFC 5530's response code and its text carry it
 * when the server does. ImapFlow surfaces a tagged NO as a bare "Command failed"
 * with the code on the error, which is why matching the message alone never
 * caught a real Dovecot answer.
 */
const saidByServer = (error: Error): string =>
	`${error.message} ${stringField(error, "responseText")}`;

/** The folder is not on the server: a delete has nothing left to do. */
const isMailboxAbsentUpstream = (error: unknown): boolean => {
	if (!(error instanceof Error)) return false;
	if (stringField(error, "serverResponseCode") === "NONEXISTENT") return true;
	return /not found|does ?n.?t exist/i.test(saidByServer(error));
};

/** The folder is already on the server: a create has nothing left to do. */
const isMailboxPresentUpstream = (error: unknown): boolean => {
	if (!(error instanceof Error)) return false;
	if (stringField(error, "serverResponseCode") === "ALREADYEXISTS") return true;
	return /already exists/i.test(saidByServer(error));
};

/**
 * Pinned invariant for the whole-chain terminal guards below.
 *
 * Each handler wraps its `MailboxManagementService.sync*` chain in a try/catch
 * that treats a NotFoundError as terminal (ack with a WARN, issue #289). That is
 * only sound while the sole row a NotFoundError can refer to is the target
 * mailbox, so its absence can only mean the user deleted the folder mid-sync —
 * never an unrelated missing entity that should have been retried.
 *
 * `syncCreate` and `syncDelete` hold to that by touching nothing but the target
 * row. `syncRename` also writes the renamed subtree's descendant rows, and keeps
 * the invariant by absorbing their NotFoundErrors itself: a descendant deleted
 * mid-settle never reaches these catches. Any sync method that reads or writes a
 * second entity owes the same, or these catches must be narrowed (match the
 * mailboxId / re-check existence) before a NotFoundError from elsewhere is
 * silently acked.
 */

/**
 * Handle MAILBOX_CREATE event
 */
const handleCreate = async (
	event: MailboxCreateEvent,
	log: Logger,
	deps: MailboxManagementDeps,
): Promise<void> => {
	const {
		getClient,
		buildLifecycleDeps,
		withOAuthLifecycle,
		createConnectionScope: createConnectionScopeWithCredentials,
	} = deps;

	const {
		account: accountService,
		mailbox: mailboxService,
		secrets,
	} = await getClient();

	const { accountId, mailboxId, path, subscribe } = event;

	log.info({ event: event.type, accountId, mailboxId, path }, "Handling event");

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
			const scope = createConnectionScopeWithCredentials(account, credentials);
			const managementService = new MailboxManagementService(
				mailboxService,
				log,
			);

			try {
				await managementService
					.syncCreate(
						accountId,
						mailboxId,
						path,
						scope.getConnection,
						subscribe,
					)
					.then((result) => {
						if (result.success) {
							log.info(
								{ accountId, mailboxId, path },
								"Mailbox created on IMAP",
							);
						} else {
							log.error(
								{ accountId, mailboxId, path, error: result.error },
								"Failed to create mailbox on IMAP",
							);
						}
					})
					.catch(async (error) => {
						// Check if mailbox already exists (idempotent)
						if (isMailboxPresentUpstream(error)) {
							log.info(
								{ accountId, mailboxId, path },
								"Mailbox already exists, marking as synced",
							);
							await mailboxService.update(accountId, mailboxId, {
								syncStatus: MailboxSyncStatus.synced,
							});
						} else {
							await mailboxService.update(accountId, mailboxId, {
								syncStatus: MailboxSyncStatus.failed,
							});
							throw error;
						}
					})
					.finally(() => scope.disconnect());
			} catch (error) {
				// The mailbox row was deleted between enqueue and this sync — the
				// create-then-status-write throws NotFoundError, which can never
				// succeed on retry and would poison the account's per-group FIFO
				// forever (issue #289, same class as #287/#290). A folder the user
				// deleted is an expected terminal outcome: ack with a WARN. Real
				// IMAP/infra failures carry other errors and still propagate.
				if (isNotFoundError(error)) {
					log.warn(
						{ accountId, mailboxId, path, eventId: event.eventId },
						"Skipping MAILBOX_CREATE: mailbox no longer exists (deleted)",
					);
					return;
				}
				throw error;
			}
		},
	);
};

/**
 * Handle MAILBOX_RENAME event
 */
const handleRename = async (
	event: MailboxRenameEvent,
	log: Logger,
	deps: MailboxManagementDeps,
): Promise<void> => {
	const {
		getClient,
		buildLifecycleDeps,
		withOAuthLifecycle,
		createConnectionScope: createConnectionScopeWithCredentials,
	} = deps;

	const {
		account: accountService,
		mailbox: mailboxService,
		secrets,
	} = await getClient();

	const { accountId, mailboxId, oldPath, newPath } = event;

	log.info(
		{ event: event.type, accountId, mailboxId, oldPath, newPath },
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
			const scope = createConnectionScopeWithCredentials(account, credentials);
			const managementService = new MailboxManagementService(
				mailboxService,
				log,
			);

			try {
				await managementService
					.syncRename(
						accountId,
						mailboxId,
						oldPath,
						newPath,
						scope.getConnection,
					)
					.then((result) => {
						if (result.success) {
							log.info(
								{ accountId, mailboxId, oldPath, newPath },
								"Mailbox renamed on IMAP",
							);
						} else {
							log.error(
								{ accountId, mailboxId, oldPath, newPath, error: result.error },
								"Failed to rename mailbox on IMAP",
							);
						}
					})
					.catch(async (error) => {
						// If source not found, delete local mailbox
						if (isMailboxAbsentUpstream(error)) {
							log.info(
								{ accountId, mailboxId, oldPath },
								"Source mailbox not found, deleting local",
							);
							await mailboxService.delete(accountId, mailboxId);
						} else {
							// Rollback local rename by restoring old path
							await mailboxService.update(accountId, mailboxId, {
								fullPath: oldPath,
								oldPath: undefined,
								syncStatus: MailboxSyncStatus.failed,
							});
							throw error;
						}
					})
					.finally(() => scope.disconnect());
			} catch (error) {
				// The mailbox row was deleted between enqueue and this sync — the
				// status write-back throws NotFoundError, unretryable and would poison
				// the account's per-group FIFO forever (issue #289 class). Ack with a
				// WARN; real IMAP/infra failures carry other errors and still propagate.
				if (isNotFoundError(error)) {
					log.warn(
						{ accountId, mailboxId, oldPath, newPath, eventId: event.eventId },
						"Skipping MAILBOX_RENAME: mailbox no longer exists (deleted)",
					);
					return;
				}
				throw error;
			}
		},
	);
};

/**
 * Handle MAILBOX_DELETE event
 */
const handleDelete = async (
	event: MailboxDeleteEvent,
	log: Logger,
	deps: MailboxManagementDeps,
): Promise<void> => {
	const {
		getClient,
		buildLifecycleDeps,
		withOAuthLifecycle,
		createConnectionScope: createConnectionScopeWithCredentials,
	} = deps;

	const {
		account: accountService,
		mailbox: mailboxService,
		secrets,
	} = await getClient();

	const { accountId, mailboxId, path } = event;

	log.info({ event: event.type, accountId, mailboxId, path }, "Handling event");

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
			const scope = createConnectionScopeWithCredentials(account, credentials);
			const managementService = new MailboxManagementService(
				mailboxService,
				log,
			);

			try {
				await managementService
					.syncDelete(accountId, mailboxId, path, scope.getConnection)
					.then((result) => {
						if (result.success) {
							log.info(
								{ accountId, mailboxId, path },
								"Mailbox deleted on IMAP",
							);
						} else {
							log.error(
								{ accountId, mailboxId, path, error: result.error },
								"Failed to delete mailbox on IMAP",
							);
						}
					})
					.catch(async (error) => {
						// If mailbox not found, it's already deleted (idempotent)
						if (isMailboxAbsentUpstream(error)) {
							log.info(
								{ accountId, mailboxId, path },
								"Mailbox not found on IMAP, deleting local",
							);
							await mailboxService.delete(accountId, mailboxId);
						} else if (
							error instanceof Error &&
							error.message.includes("Cannot delete INBOX")
						) {
							// Restore the mailbox
							await mailboxService.update(accountId, mailboxId, {
								syncStatus: MailboxSyncStatus.synced,
							});
							log.error(
								{ accountId, mailboxId, path },
								"Cannot delete INBOX, restoring mailbox",
							);
							// Don't rethrow - this is an expected error
						} else {
							// Restore the mailbox on other errors
							await mailboxService.update(accountId, mailboxId, {
								syncStatus: MailboxSyncStatus.failed,
							});
							throw error;
						}
					})
					.finally(() => scope.disconnect());
			} catch (error) {
				// The mailbox row was already deleted (a duplicate/racing delete) — the
				// error-recovery status write throws NotFoundError, unretryable and
				// would poison the account's per-group FIFO forever (issue #289 class).
				// The delete has effectively happened: ack with a WARN. Real IMAP/infra
				// failures carry other errors and still propagate.
				if (isNotFoundError(error)) {
					log.warn(
						{ accountId, mailboxId, path, eventId: event.eventId },
						"Skipping MAILBOX_DELETE: mailbox no longer exists (deleted)",
					);
					return;
				}
				throw error;
			}
		},
	);
};

/**
 * Process mailbox management events
 */
export const processMailboxManagement = async (
	event: MailboxManagementEvent,
	log: Logger,
	deps: MailboxManagementDeps = defaultDeps,
): Promise<void> => {
	switch (event.type) {
		case "MAILBOX_CREATE":
			return handleCreate(event, log, deps);
		case "MAILBOX_RENAME":
			return handleRename(event, log, deps);
		case "MAILBOX_DELETE":
			return handleDelete(event, log, deps);
	}
};
