import type { IMailboxRepository, MailboxItem } from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import { rebaseMailboxPath } from "@remit/data-ports/mailbox-name";
import { MailboxSyncStatus } from "@remit/domain-enums";
import { recordedByRename } from "./mailbox-intent.js";
import { isNotFoundError } from "./mailbox-presence.js";
import {
	FolderGoneUpstreamError,
	FolderRenameSettleError,
	isMailboxAbsentUpstream,
} from "./mailbox-upstream.js";
import type { FlatMailboxInfo, IImapConnection } from "./types.js";

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
	/**
	 * Where the folder ended up, on a rename the server confirmed. Absent when
	 * the recorded intent had already moved on, so no RENAME was issued —
	 * which is how a caller tells the two apart without a second read.
	 */
	renamed?: { oldPath: string; newPath: string; delimiter: string };
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
	if (path.toUpperCase() !== "INBOX") return;
	// A RENAME of INBOX moves its mail to the new name and leaves an empty INBOX
	// behind — a bulk move wearing a rename's clothes, which strands the
	// account's inbox appointment and voids the row's UID cursor (D5). The API
	// refuses it; this is the backstop for anything that reaches the worker
	// another way.
	throw new Error(
		operation === "delete" ? "Cannot delete INBOX" : "Cannot rename INBOX",
	);
};

/**
 * Whether the server's own listing holds a path this code named.
 *
 * The requested string and the path the server keeps are not the same thing.
 * Under a namespace prefix a Dovecot INBOX namespace stores `Projects` as
 * `INBOX.Projects`, which is why the settle adopts the path ImapFlow resolved
 * rather than the one that was asked for (D2) — and a probe comparing the raw
 * request against the listing would read a folder that is plainly there as
 * absent. There is no resolved path to adopt on the failure path, so the
 * account's own prefix stands in for the normalization.
 */
const holdsPath = (
	onServer: ReadonlySet<string>,
	mailbox: Pick<MailboxItem, "namespacePrefix">,
	path: string,
): boolean => {
	if (onServer.has(path)) return true;
	const { namespacePrefix } = mailbox;
	if (namespacePrefix.length === 0) return false;
	if (path.startsWith(namespacePrefix)) return false;
	return onServer.has(`${namespacePrefix}${path}`);
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
	 * Settle a create: `pending` with **no** recorded rename target, which is the
	 * state a create in flight is (D3, D10).
	 *
	 * The absence check is what the whole `wherePendingPath` predicate exists
	 * for. A create whose acknowledgement was lost, redelivered against a row a
	 * rename has since claimed, passes a `pending`-only guard; the CREATE
	 * collides, ImapFlow reports the collision as `{created: false}` rather than
	 * an error, and this write then strands the row `synced` with a rename
	 * target on it — the seventh combination — leaving the rename's own settle
	 * with nothing to match and the RENAME never running.
	 *
	 * A null means the row is gone or the intent moved on. The handlers'
	 * #289-class terminal guards classify the NotFoundError as the user having
	 * deleted the folder mid-sync.
	 */
	private settleCreate = async (
		accountId: string,
		mailboxId: string,
		confirmedPath?: string,
	): Promise<void> => {
		const settled = await this.mailboxService.transition(accountId, mailboxId, {
			from: [MailboxSyncStatus.pending],
			wherePendingPath: null,
			to: MailboxSyncStatus.synced,
			set: confirmedPath !== undefined ? { fullPath: confirmedPath } : {},
		});
		if (settled) return;
		// Either the row is gone, or a rename claimed it while this create was in
		// flight. Both resolve the job: the folder exists, and the rename is the
		// live intent.
		const current = await this.mailboxService
			.get(accountId, mailboxId)
			.catch((error: unknown) => {
				if (isNotFoundError(error)) return undefined;
				throw error;
			});
		if (!current) throw new NotFoundError(`Mailbox not found: ${mailboxId}`);
		this.log.info(
			{
				accountId,
				mailboxId,
				intent: "create",
				from: current.syncStatus,
				outcome: "superseded",
			},
			"Folder create superseded",
		);
	};

	/**
	 * The rows one rename intent recorded, each with the path it settles to.
	 *
	 * The settle deliberately does not re-resolve the subtree (D15): membership
	 * changes between the intent and the settle — the sweep inserts a row,
	 * another client deletes a descendant — and an all-or-nothing settle then
	 * either throws, poisoning the account's FIFO group (#339), or resolves
	 * leaving every row `pending` forever with no route out, because `failed` is
	 * only reachable from a settle that ran.
	 *
	 * So the rows identify themselves, by the pair `recordedByRename` tests: a
	 * target at or under the rename's target is not on its own enough, because a
	 * second folder renamed under the same branch would be claimed by a rename
	 * that never touched it. A row that appeared afterwards carries no such pair
	 * and is not touched.
	 *
	 * `confirmedPath` re-prefixes each recorded target off the path the rename
	 * actually resolved to, so a normalization the requested string did not carry
	 * moves the whole branch rather than the folder alone.
	 *
	 * `delimiter` is the renamed folder's own, read from the row the caller
	 * already holds — deriving one from whatever the listing happens to contain
	 * strands every descendant when that row has gone.
	 */
	private intentCarryingRows = async (
		accountId: string,
		oldPath: string,
		target: string,
		confirmed: string,
		delimiter: string,
	): Promise<{ row: MailboxItem; confirmedPath: string }[]> => {
		const pending = await this.mailboxService.findBySyncStatus(
			accountId,
			MailboxSyncStatus.pending,
		);
		const carrying: { row: MailboxItem; confirmedPath: string }[] = [];
		for (const row of pending) {
			if (!recordedByRename(row, oldPath, target, delimiter)) continue;
			const confirmedPath = rebaseMailboxPath(
				row.pendingPath as string,
				target,
				confirmed,
				delimiter,
			);
			if (confirmedPath === undefined) continue;
			carrying.push({ row, confirmedPath });
		}
		return carrying;
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
			await this.settleCreate(accountId, mailboxId, confirmedPath);

			await connection.closeBox();
		} else {
			// Mark as synced even if we couldn't get full info
			await this.settleCreate(accountId, mailboxId, confirmedPath);
		}

		return { success: true };
	};

	/**
	 * Sync a RENAME operation to IMAP and settle the rows that recorded it (T5).
	 * Called by worker after dequeuing MAILBOX_RENAME event.
	 *
	 * Guarded on the intent, not on the event (D10): the row must still be
	 * `pending` with this event's target recorded, or the rename resolves with no
	 * IMAP call at all. That is what stops a redelivered MAILBOX_RENAME re-issuing
	 * a RENAME from a path that has already moved.
	 *
	 * @param accountId - Account that owns the mailbox (tenant scope)
	 * @param mailboxId - ID of the mailbox to rename
	 * @param oldPath - Path the intent was recorded against
	 * @param newPath - Target the intent recorded
	 * @param getConnection - Factory to get IMAP connection
	 */
	syncRename = async (
		accountId: string,
		mailboxId: string,
		oldPath: string,
		newPath: string,
		getConnection: () => Promise<IImapConnection>,
	): Promise<MailboxManagementSyncResult> => {
		const standing = await this.renameIntentStanding(
			accountId,
			mailboxId,
			newPath,
		);
		if (!standing) return { success: true };

		const connection = await getConnection();
		const delimiter = standing.hierarchyDelimiter;

		const confirmed = await this.issueRename(
			connection,
			standing,
			accountId,
			mailboxId,
			oldPath,
			newPath,
		);

		this.log.info(
			{ accountId, mailboxId, intent: "rename", oldPath, newPath, confirmed },
			"Renamed mailbox on IMAP server",
		);

		// The server has executed the rename. Nothing after this point may reach
		// the caller's failure path: `failRename` would mark the rows refused for
		// a rename that landed, and the folder would sit at `failed` offering a
		// retry of something already done. A settle that cannot finish is wrapped
		// so the caller can tell the two apart, and rethrown so SQS redelivers —
		// the rows are still `pending` with their targets, so the redelivery's
		// guard passes and the settle runs again.
		await this.settleRenameIntent(
			accountId,
			mailboxId,
			oldPath,
			newPath,
			confirmed,
			delimiter,
		).catch((error: unknown) => {
			throw new FolderRenameSettleError(mailboxId, confirmed, error);
		});

		return {
			success: true,
			renamed: { oldPath, newPath: confirmed, delimiter },
		};
	};

	/**
	 * Issue the RENAME and read back the path it resolved to.
	 *
	 * A `NONEXISTENT` here has three readings, and only one of them may destroy
	 * anything. Either another client deleted the folder; or this rename already
	 * landed and only its settle was lost, in which case the folder is alive at
	 * the target; or the server is saying something this code cannot classify.
	 * The listing separates the first two, and everything it cannot answer is a
	 * refused rename (T6) — a rename that failed costs the user a retry, while
	 * reading an unclear answer as a delete costs them the folder's mail.
	 *
	 * So the caller is told which of the two it is by the *kind* of error, never
	 * by re-reading the server's code: only `FolderGoneUpstreamError` removes a
	 * folder, and it is raised exactly where the listing held neither path.
	 */
	private issueRename = async (
		connection: IImapConnection,
		standing: MailboxItem,
		accountId: string,
		mailboxId: string,
		oldPath: string,
		newPath: string,
	): Promise<string> => {
		const result = await connection
			.renameMailbox(oldPath, newPath)
			.catch(async (error: unknown) => {
				if (!isMailboxAbsentUpstream(error)) throw error;
				const listed = await connection
					.listMailboxes()
					.catch((): FlatMailboxInfo[] | undefined => undefined);
				// A listing that cannot be read answers nothing, so it decides
				// nothing: the rename is refused and the folder is left alone.
				if (!listed) throw error;

				const onServer = new Set(listed.map((mailbox) => mailbox.fullPath));
				if (holdsPath(onServer, standing, newPath)) {
					this.log.info(
						{ accountId, mailboxId, intent: "rename", oldPath, newPath },
						"Source folder gone and the target is on the server: this rename already landed",
					);
					return undefined;
				}
				if (holdsPath(onServer, standing, oldPath)) throw error;

				throw new FolderGoneUpstreamError(mailboxId, oldPath, error);
			});

		// ImapFlow's own normalization of the requested path — namespace prefix
		// applied, special names resolved, delimiter joined. IMAP's RENAME reply
		// carries no path, so this is not the server echoing a name back and it
		// cannot detect a server that stored a different one; adopting it is still
		// right, because it fixes the prefix and delimiter drift the requested
		// string carries (D2).
		return typeof result?.newPath === "string" && result.newPath.length > 0
			? result.newPath
			: newPath;
	};

	/**
	 * Whether the rename this event was enqueued for is still the folder's live
	 * intent. `pending` alone cannot answer it — that state covers a create in
	 * flight too — so the recorded target is half the predicate, and it is the
	 * same predicate the settling write carries, so the guard and the write
	 * cannot disagree between the read and the write.
	 */
	private renameIntentStanding = async (
		accountId: string,
		mailboxId: string,
		newPath: string,
	): Promise<MailboxItem | undefined> => {
		const row = await this.mailboxService
			.get(accountId, mailboxId)
			.catch((error: unknown) => {
				if (isNotFoundError(error)) return undefined;
				throw error;
			});
		if (
			row &&
			row.syncStatus === MailboxSyncStatus.pending &&
			row.pendingPath === newPath
		) {
			return row;
		}
		this.log.info(
			{
				accountId,
				mailboxId,
				intent: "rename",
				from: row?.syncStatus,
				newPath,
				outcome: row ? "superseded" : "already-settled",
			},
			"Skipping MAILBOX_RENAME: the recorded intent has moved on",
		);
		return undefined;
	};

	/**
	 * T5, per row (D15): each intent-carrying row adopts its own confirmed path,
	 * drops the recorded target and settles `synced`, on its own conditional
	 * write. A row another client moved in between fails its predicate and is
	 * skipped rather than overwritten; a row that is gone is skipped for free.
	 *
	 * **The named folder is written last, and that ordering is load-bearing.**
	 * The redelivery's guard reads that row and nothing else, so it is the
	 * witness for the whole settle: while it still carries the intent, a
	 * redelivery re-enters and finishes whatever the last attempt left. Settling
	 * it first would ack a run that died part-way through its descendants, and
	 * those rows would stay `pending` forever — invisible to message sync, and
	 * with no route out, because an intent may only be recorded from `synced` or
	 * `failed`, so neither a retry nor a dismissal can reach them.
	 */
	private settleRenameIntent = async (
		accountId: string,
		mailboxId: string,
		oldPath: string,
		target: string,
		confirmed: string,
		delimiter: string,
	): Promise<void> => {
		const carrying = await this.intentCarryingRows(
			accountId,
			oldPath,
			target,
			confirmed,
			delimiter,
		);
		const ordered = [
			...carrying.filter((entry) => entry.row.mailboxId !== mailboxId),
			...carrying.filter((entry) => entry.row.mailboxId === mailboxId),
		];
		for (const { row, confirmedPath } of ordered) {
			const settled = await this.mailboxService.transition(
				accountId,
				row.mailboxId,
				{
					from: [MailboxSyncStatus.pending],
					wherePendingPath: row.pendingPath,
					to: MailboxSyncStatus.synced,
					set: { fullPath: confirmedPath },
				},
			);
			this.log.info(
				{
					accountId,
					mailboxId: row.mailboxId,
					intent: "rename",
					from: MailboxSyncStatus.pending,
					to: MailboxSyncStatus.synced,
					fullPath: confirmedPath,
					outcome: settled ? "settled" : "superseded",
				},
				"Settled renamed folder",
			);
		}
	};

	/**
	 * T6: the rename did not land, so every row that recorded it goes to
	 * `failed`, keeping its target so the client can name what the rename was
	 * aiming at and offer a retry. Nothing is restored — `fullPath` was never
	 * written, which is the whole point of recording the target instead (D2).
	 */
	failRename = async (
		accountId: string,
		mailboxId: string,
		oldPath: string,
		newPath: string,
	): Promise<void> => {
		const root = await this.mailboxService
			.get(accountId, mailboxId)
			.catch((error: unknown) => {
				if (isNotFoundError(error)) return undefined;
				throw error;
			});
		if (!root) throw new NotFoundError(`Mailbox not found: ${mailboxId}`);

		const carrying = await this.intentCarryingRows(
			accountId,
			oldPath,
			newPath,
			newPath,
			root.hierarchyDelimiter,
		);
		// The row is there and no row carries the intent, so this refusal has
		// nothing to record. It must not be reported as a missing mailbox: the
		// caller's #289-class guard reads a NotFoundError as the user having
		// deleted the folder and acks the message, which would swallow the IMAP
		// error that brought us here and leave the subtree `pending`. Say so and
		// let the caller rethrow what actually failed.
		if (carrying.length === 0) {
			this.log.error(
				{
					accountId,
					mailboxId,
					intent: "rename",
					from: root.syncStatus,
					oldPath,
					newPath,
					outcome: "superseded",
				},
				"Refused rename recorded nothing: no row carries this intent",
			);
			return;
		}
		for (const { row } of carrying) {
			const failed = await this.mailboxService.transition(
				accountId,
				row.mailboxId,
				{
					from: [MailboxSyncStatus.pending],
					wherePendingPath: row.pendingPath,
					to: MailboxSyncStatus.failed,
				},
			);
			this.log.info(
				{
					accountId,
					mailboxId: row.mailboxId,
					intent: "rename",
					from: MailboxSyncStatus.pending,
					to: MailboxSyncStatus.failed,
					outcome: failed ? "refused" : "superseded",
				},
				"Recorded a refused rename",
			);
		}
	};

	/**
	 * The folder the rename was to move was found gone from the server, and
	 * the target was not there either, so it was deleted by another client
	 * mid-rename (D8). Every row that recorded this rename's intent — the
	 * root and each descendant — goes with its mail, the same walk `failRename`
	 * uses: deleting the root alone strands every descendant `pending` with
	 * nothing left to revisit it, which is the orphaning bug this closes.
	 */
	abandonRenameSubtree = async (
		accountId: string,
		mailboxId: string,
		oldPath: string,
		newPath: string,
	): Promise<void> => {
		const root = await this.mailboxService
			.get(accountId, mailboxId)
			.catch((error: unknown) => {
				if (isNotFoundError(error)) return undefined;
				throw error;
			});
		if (!root) {
			this.log.info(
				{ accountId, mailboxId, intent: "rename", outcome: "already-settled" },
				"Nothing to abandon: the folder row is already gone",
			);
			return;
		}

		const carrying = await this.intentCarryingRows(
			accountId,
			oldPath,
			newPath,
			newPath,
			root.hierarchyDelimiter,
		);
		// A removal that throws part-way abandons the rest into a redelivery, and
		// that is safe rather than merely tolerable: `deleteMailboxWithMail` is
		// idempotent — it returns without touching anything when the row is gone,
		// and resumes from whatever is left when it is not, because the mailbox
		// row is removed last. The rows still standing carry the intent, so the
		// next attempt resolves the same set and finishes it.
		for (const { row } of carrying) {
			await this.mailboxService.deleteMailboxWithMail(accountId, row.mailboxId);
			this.log.info(
				{
					accountId,
					mailboxId: row.mailboxId,
					intent: "rename",
					from: MailboxSyncStatus.pending,
					to: "deleted",
				},
				"Source mailbox not found, deleted local folder and its mail",
			);
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
