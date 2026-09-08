import type { IMailboxRepository } from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import { MailboxSyncStatus } from "@remit/domain-enums";
import { EVERY_MAILBOX_STATE, isNotFoundError } from "./mailbox-presence.js";
import type { IImapConnection } from "./types.js";

/**
 * Input for creating a mailbox
 */
export interface CreateMailboxInput {
	accountId: string;
	path: string;
	subscribe?: boolean;
}

/**
 * Input for renaming a mailbox
 */
export interface RenameMailboxInput {
	mailboxId: string;
	newPath: string;
}

/**
 * Input for deleting a mailbox
 */
export interface DeleteMailboxInput {
	mailboxId: string;
	force?: boolean;
}

/**
 * Result of syncing mailbox operation to IMAP
 */
export interface MailboxManagementSyncResult {
	success: boolean;
	error?: string;
}

/**
 * Logger interface for MailboxManagementService
 */
export interface MailboxManagementLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	error(obj: Record<string, unknown>, msg: string): void;
}

const noopLogger: MailboxManagementLogger = {
	info: () => {},
	error: () => {},
};

/**
 * Parse a mailbox path to extract name and parent path
 */
export const parseMailboxPath = (
	path: string,
	delimiter = "/",
): { name: string; parent: string | null; depth: number } => {
	const parts = path.split(delimiter);
	return {
		name: parts[parts.length - 1],
		parent: parts.length > 1 ? parts.slice(0, -1).join(delimiter) : null,
		depth: parts.length,
	};
};

/**
 * Validate mailbox path for invalid characters and operations
 */
export const validateMailboxPath = (path: string): void => {
	if (!path || path.trim().length === 0) {
		throw new Error("Mailbox path cannot be empty");
	}

	// Check for double delimiters
	if (path.includes("//")) {
		throw new Error("Mailbox path cannot contain empty hierarchy levels");
	}

	// Check for leading/trailing delimiters
	if (path.startsWith("/") || path.endsWith("/")) {
		throw new Error(
			"Mailbox path cannot start or end with hierarchy delimiter",
		);
	}
};

/**
 * Validate that an operation can be performed on a mailbox path
 */
export const validateMailboxOperation = (
	operation: "delete" | "rename",
	path: string,
): void => {
	if (path.toUpperCase() === "INBOX" && operation === "delete") {
		throw new Error("Cannot delete INBOX");
	}
};

/**
 * Service for managing mailbox operations (create, rename, delete).
 *
 * Implements an optimistic local-first pattern:
 * 1. Updates are applied locally first
 * 2. Changes are queued for IMAP sync via SQS
 * 3. Worker processes queue and syncs to IMAP server
 */
export class MailboxManagementService {
	private log: MailboxManagementLogger;

	constructor(
		private mailboxService: IMailboxRepository,
		logger?: MailboxManagementLogger,
	) {
		this.log = logger ?? noopLogger;
	}

	/**
	 * Write the settled state back, as the conditional write that is now the
	 * only way to write it at all (D3). The from-set is every state because that
	 * is what this settle decides against today — it is the unconditional write
	 * it replaces, moved onto the door; #363 narrows it to the state its intent
	 * recorded and gives a lost predicate its `already-settled` outcome.
	 *
	 * A null means the row is gone, which is what the unconditional write raised
	 * a NotFoundError for, and what the handlers' #289-class terminal guards
	 * classify as the user having deleted the folder mid-sync.
	 */
	private settle = async (
		accountId: string,
		mailboxId: string,
		confirmedPath?: string,
	): Promise<void> => {
		const settled = await this.mailboxService.transition(accountId, mailboxId, {
			from: EVERY_MAILBOX_STATE,
			to: MailboxSyncStatus.synced,
			set: confirmedPath !== undefined ? { fullPath: confirmedPath } : {},
		});
		if (!settled) throw new NotFoundError(`Mailbox not found: ${mailboxId}`);
	};

	/**
	 * Sync a CREATE operation to IMAP.
	 * Called by worker after dequeuing MAILBOX_CREATE event.
	 *
	 * @param accountId - Account that owns the mailbox (tenant scope)
	 * @param mailboxId - ID of the mailbox to create
	 * @param path - Path of the mailbox to create
	 * @param getConnection - Factory to get IMAP connection
	 * @param subscribe - Whether to subscribe after creation
	 */
	syncCreate = async (
		accountId: string,
		mailboxId: string,
		path: string,
		getConnection: () => Promise<IImapConnection>,
		subscribe?: boolean,
	): Promise<MailboxManagementSyncResult> => {
		const connection = await getConnection();

		const result = await connection.createMailbox(path);

		// The server is free to materialize the requested path under a namespace
		// prefix — a Dovecot INBOX namespace turns "Notifications" into
		// "INBOX/Notifications". `mailboxCreate` reports the canonical path the
		// server assigned; adopt it as this row's identity so the next mailbox
		// reconcile matches it by fullPath and updates it in place, rather than
		// inserting a fresh row for the prefixed path and deleting this one — which
		// would strand every filter and placement that references this mailboxId.
		// Fall back to the requested path when the result carries no usable path,
		// so a thin result never blanks the row's fullPath to undefined.
		const serverPath =
			typeof result.path === "string" && result.path.length > 0
				? result.path
				: path;
		const confirmedPath = serverPath !== path ? serverPath : undefined;

		this.log.info(
			{ mailboxId, path, serverPath, created: result.created },
			"Created mailbox on IMAP server",
		);

		if (subscribe) {
			await connection.subscribeMailbox(serverPath);
			this.log.info({ mailboxId, path: serverPath }, "Subscribed to mailbox");
		}

		// Refresh mailbox list to get UIDVALIDITY and other attributes
		const mailboxes = await connection.listMailboxes();
		const mailboxInfo = mailboxes.find((m) => m.fullPath === serverPath);

		if (mailboxInfo) {
			// Open the mailbox to get UIDVALIDITY and other status info
			const status = await connection.openBox(serverPath, true);

			// Two writes where there was one, and the settle is deliberately the
			// second: counters are ordinary metadata and stay off the transition,
			// whose whole point is that its write-set is the state (D3). A crash in
			// between leaves the row `pending` with fresh counters, and the row not
			// yet settled is what keeps the queue message unacked — the redelivery
			// re-issues CREATE, the server answers ALREADYEXISTS, and #339's
			// classification settles it. Settling first would be the unsafe order.
			await this.mailboxService.update(accountId, mailboxId, {
				uidValidity: status.uidvalidity,
				uidNext: status.uidnext,
				messageCount: status.messages.total,
			});
			await this.settle(accountId, mailboxId, confirmedPath);

			await connection.closeBox();
		} else {
			// Mark as synced even if we couldn't get full info
			await this.settle(accountId, mailboxId, confirmedPath);
		}

		return { success: true };
	};

	/**
	 * Sync a RENAME operation to IMAP.
	 * Called by worker after dequeuing MAILBOX_RENAME event.
	 *
	 * @param accountId - Account that owns the mailbox (tenant scope)
	 * @param mailboxId - ID of the mailbox to rename
	 * @param oldPath - Current path of the mailbox
	 * @param newPath - New path for the mailbox
	 * @param getConnection - Factory to get IMAP connection
	 */
	syncRename = async (
		accountId: string,
		mailboxId: string,
		oldPath: string,
		newPath: string,
		getConnection: () => Promise<IImapConnection>,
	): Promise<MailboxManagementSyncResult> => {
		const connection = await getConnection();

		await connection.renameMailbox(oldPath, newPath);

		this.log.info(
			{ mailboxId, oldPath, newPath },
			"Renamed mailbox on IMAP server",
		);

		await this.settle(accountId, mailboxId);

		// The server rename is done and the row records it. The settle is repair
		// work on top of that, so nothing it hits — the listing included — may reach
		// the caller's failure path, which rolls the row back to a path the server
		// no longer has and hands it to the reconcile sweep to reap.
		await this.settleRenamedSubtree(accountId, newPath, connection).catch(
			(error: unknown) => {
				this.log.error(
					{ mailboxId, newPath, error },
					"Renamed subtree left pending",
				);
			},
		);

		return { success: true };
	};

	/**
	 * IMAP RENAME moves the whole subtree in one command, so the descendants the
	 * local rename marked pending are on the server the moment the parent's is.
	 * Nothing else settles them: the reconcile sweep treats pending as in-flight
	 * and leaves it alone, and a descendant left pending is read as off-server, so
	 * its sync events are terminally acked and its mail never arrives.
	 *
	 * A descendant is settled only where the server's own listing holds its path.
	 * A local path the server has not materialized is still in flight behind
	 * another queued operation, and stripping its pending marker would expose the
	 * row to the reconcile sweep.
	 */
	private settleRenamedSubtree = async (
		accountId: string,
		newPath: string,
		connection: IImapConnection,
	): Promise<void> => {
		const listed = await connection.listMailboxes();
		const onServer = new Set(listed.map((mailbox) => mailbox.fullPath));
		const delimiter =
			listed.find((mailbox) => mailbox.fullPath === newPath)?.delimiter ??
			listed[0]?.delimiter ??
			"/";

		const descendants = await this.mailboxService.findByPathPrefix(
			accountId,
			newPath,
			delimiter,
		);

		for (const descendant of descendants) {
			if (!onServer.has(descendant.fullPath)) continue;
			// The per-row settle of D15: `pending` is the state that carries the
			// intent, and the predicate is on the UPDATE, so a row another client
			// moved in between is skipped rather than overwritten. A row that is
			// gone is skipped for free — a null is not an error here, which is what
			// keeps a descendant deleted mid-settle out of the handler's
			// whole-chain NotFoundError guard.
			await this.mailboxService.transition(accountId, descendant.mailboxId, {
				from: [MailboxSyncStatus.pending],
				to: MailboxSyncStatus.synced,
			});
		}
	};

	/**
	 * Sync a DELETE operation to IMAP.
	 * Called by worker after dequeuing MAILBOX_DELETE event.
	 *
	 * @param accountId - Account that owns the mailbox (tenant scope)
	 * @param mailboxId - ID of the mailbox to delete
	 * @param path - Path of the mailbox to delete
	 * @param getConnection - Factory to get IMAP connection
	 */
	syncDelete = async (
		accountId: string,
		mailboxId: string,
		path: string,
		getConnection: () => Promise<IImapConnection>,
	): Promise<MailboxManagementSyncResult> => {
		const connection = await getConnection();

		await connection.deleteMailbox(path);

		this.log.info({ mailboxId, path }, "Deleted mailbox on IMAP server");

		// Delete the mailbox entity from the local store
		await this.mailboxService.delete(accountId, mailboxId);

		return { success: true };
	};
}
