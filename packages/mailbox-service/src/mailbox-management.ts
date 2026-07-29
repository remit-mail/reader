import type { IMailboxRepository, MailboxItem } from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";
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
		const pathUpdate = serverPath !== path ? { fullPath: serverPath } : {};

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

			await this.mailboxService.update(accountId, mailboxId, {
				...pathUpdate,
				uidValidity: status.uidvalidity,
				uidNext: status.uidnext,
				messageCount: status.messages.total,
				syncStatus: MailboxSyncStatus.synced,
			});

			await connection.closeBox();
		} else {
			// Mark as synced even if we couldn't get full info
			await this.mailboxService.update(accountId, mailboxId, {
				...pathUpdate,
				syncStatus: MailboxSyncStatus.synced,
			});
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

		// Clear oldPath and mark as synced
		const renamed = await this.mailboxService.update(accountId, mailboxId, {
			oldPath: undefined,
			syncStatus: MailboxSyncStatus.synced,
		});

		await this.settleRenamedSubtree(accountId, renamed);

		return { success: true };
	};

	/**
	 * IMAP RENAME moves the whole subtree in one command, so the descendants the
	 * local rename marked pending are on the server the moment the parent's is.
	 * Nothing else settles them: the reconcile sweep treats pending as in-flight
	 * and leaves it alone, and a descendant left pending is read as off-server, so
	 * its sync events are terminally acked and its mail never arrives.
	 *
	 * The settle is scoped by the new prefix and takes only pending rows, which is
	 * what keeps it from overreaching. A second rename in flight has already moved
	 * its descendants under a different prefix, so this sweep cannot see them and
	 * cannot declare them landed early. A descendant the user deleted or whose own
	 * operation failed carries `deleting` or `failed`, and that verdict stands.
	 */
	private settleRenamedSubtree = async (
		accountId: string,
		renamed: MailboxItem,
	): Promise<void> => {
		const descendants = await this.mailboxService.findByPathPrefix(
			accountId,
			renamed.fullPath,
			renamed.hierarchyDelimiter,
		);

		for (const descendant of descendants) {
			if (descendant.syncStatus !== MailboxSyncStatus.pending) continue;
			await this.mailboxService.update(accountId, descendant.mailboxId, {
				syncStatus: MailboxSyncStatus.synced,
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
