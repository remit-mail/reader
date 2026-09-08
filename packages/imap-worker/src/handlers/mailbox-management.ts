import { getClient } from "@remit/backend/client";
import { refreshFolderAppointmentLabels } from "@remit/backend/folder-role-labels";
import type { IMailboxRepository } from "@remit/data-ports";
import { isNotFoundError, NotFoundError } from "@remit/data-ports/errors";
import { MailboxSyncStatus } from "@remit/domain-enums";
import type { Logger } from "@remit/logger-lambda";
import {
	EVERY_MAILBOX_STATE,
	FolderRenameSettleError,
	isMailboxAbsentUpstream,
	isMailboxPresentUpstream,
	MailboxManagementService,
} from "@remit/mailbox-service";
import { isAccountDeleted } from "../account-check.js";
import { createConnectionScopeWithCredentials } from "../connection-scope.js";
import type {
	MailboxCreateEvent,
	MailboxDeleteEvent,
	MailboxManagementEvent,
	MailboxRenameEvent,
} from "../events.js";
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

/**
 * Write the outcome of a folder operation back, as the conditional write that
 * is the only way to write a folder's state
 * (docs/architecture/folder-rename-and-delete.md D3).
 *
 * The from-set is every state because that is what this write-back decides
 * against today — it is the unconditional write it replaces, moved onto the
 * door. #362 narrows the delete's to the state its intent recorded. A null
 * means the row is gone, which is the NotFoundError the whole-chain guards
 * below classify as the user having deleted the folder mid-sync.
 */
const recordOutcome = async (
	mailboxService: Pick<IMailboxRepository, "transition">,
	accountId: string,
	mailboxId: string,
	to: (typeof MailboxSyncStatus)[keyof typeof MailboxSyncStatus],
): Promise<void> => {
	const written = await mailboxService.transition(accountId, mailboxId, {
		from: EVERY_MAILBOX_STATE,
		to,
		set: {},
	});
	if (!written) throw new NotFoundError(`Mailbox not found: ${mailboxId}`);
};

/**
 * The outcome of a create, written against the state a create in flight is:
 * `pending` with no recorded rename target (D3, D10). Without the absence
 * check, a create redelivered after a lost acknowledgement settles a row a
 * rename has since claimed and kills the rename silently.
 */
const recordCreateOutcome = async (
	mailboxService: Pick<IMailboxRepository, "transition">,
	accountId: string,
	mailboxId: string,
	to: (typeof MailboxSyncStatus)[keyof typeof MailboxSyncStatus],
): Promise<void> => {
	const written = await mailboxService.transition(accountId, mailboxId, {
		from: [MailboxSyncStatus.pending],
		wherePendingPath: null,
		to,
		set: {},
	});
	if (!written) throw new NotFoundError(`Mailbox not found: ${mailboxId}`);
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
 * row. `syncRename` also writes every other row that recorded the same intent,
 * and keeps the invariant by treating a lost predicate as an outcome rather than
 * an error: a descendant deleted mid-settle is skipped, never raised. The
 * appointment-label refresh writes `account_setting` rows, whose reads answer
 * absent rather than throwing. Any sync method that reads or writes a second
 * entity owes the same, or these catches must be narrowed (match the mailboxId /
 * re-check existence) before a NotFoundError from elsewhere is silently acked.
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
							await recordCreateOutcome(
								mailboxService,
								accountId,
								mailboxId,
								MailboxSyncStatus.synced,
							);
						} else {
							await recordCreateOutcome(
								mailboxService,
								accountId,
								mailboxId,
								MailboxSyncStatus.failed,
							);
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
		accountSetting: accountSettingService,
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
					.then(async (result) => {
						if (!result.success) {
							log.error(
								{ accountId, mailboxId, oldPath, newPath, error: result.error },
								"Failed to rename mailbox on IMAP",
							);
							return;
						}
						log.info(
							{ accountId, mailboxId, oldPath, newPath },
							"Mailbox renamed on IMAP",
						);
						if (!result.renamed) return;
						// The path recorded beside each role appointment (#887) moves with
						// the settle, because under D2 that is the first moment the new
						// path is one the server holds.
						//
						// A label is display-only and this runs after the server rename
						// landed, so letting it fail would take the job down the failure
						// path and mark a completed rename refused. Logged and dropped;
						// the next appointment write records the folder's current path
						// anyway.
						await refreshFolderAppointmentLabels(
							accountSettingService,
							account.accountConfigId,
							accountId,
							{
								mailboxId,
								oldPath: result.renamed.oldPath,
								newPath: result.renamed.newPath,
							},
							result.renamed.delimiter,
						).catch((error: unknown) => {
							log.error(
								{ accountId, mailboxId, oldPath, newPath, error },
								"Renamed folder settled, but its role-appointment labels did not move",
							);
						});
					})
					.catch(async (error) => {
						// The server executed the rename and only the local settle did not
						// finish. That is not a refused rename: marking the rows `failed`
						// would offer a retry of work already done and leave `fullPath`
						// naming a path the server no longer holds. Rethrow, so the
						// redelivery finishes the settle against an intent still standing.
						if (error instanceof FolderRenameSettleError) {
							log.error(
								{ accountId, mailboxId, oldPath, newPath, error },
								"Rename landed on the server; the settle will finish on redelivery",
							);
							throw error;
						}
						// The folder the rename was to move is gone from the server, and
						// the target is not there either, so it was deleted under us.
						// Removing the row on its own is the orphaning bug: the folder's
						// mail stays keyed to a dead mailboxId, out of every reader and
						// still in the search index (D8).
						if (isMailboxAbsentUpstream(error)) {
							log.info(
								{ accountId, mailboxId, oldPath, intent: "rename" },
								"Source mailbox not found, deleting local folder and its mail",
							);
							await mailboxService.deleteMailboxWithMail(accountId, mailboxId);
							return;
						}
						// T6. Nothing is restored — `fullPath` was never written, and
						// each intent-carrying row keeps its target so the client can
						// name what the rename was aiming at and offer a retry.
						await managementService.failRename(
							accountId,
							mailboxId,
							oldPath,
							newPath,
						);
						throw error;
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
							await recordOutcome(
								mailboxService,
								accountId,
								mailboxId,
								MailboxSyncStatus.synced,
							);
							log.error(
								{ accountId, mailboxId, path },
								"Cannot delete INBOX, restoring mailbox",
							);
							// Don't rethrow - this is an expected error
						} else {
							// Restore the mailbox on other errors
							await recordOutcome(
								mailboxService,
								accountId,
								mailboxId,
								MailboxSyncStatus.failed,
							);
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
