/**
 * Mailbox synchronization service
 *
 * Orchestrates syncing mailbox data from IMAP server to the data backend.
 */

import type {
	CreateMailboxInput,
	IMailboxRepository,
	IMailboxSpecialUseRepository,
	MailboxItem,
} from "@remit/data-ports";
import {
	CANONICAL_ROLES,
	type CanonicalMailboxRoleValue,
	ROLE_NAME_HINTS,
	ROLE_SPECIAL_USE,
} from "@remit/data-ports/folder-role";
import {
	MailboxCursorState,
	type MailboxSpecialUse,
	MailboxSyncStatus,
	NamespaceType,
} from "@remit/domain-enums";
import pMap from "p-map";
import { isNoSelect, parseImapAttributes } from "./attribute-mapper.js";
import { isCursorRebuildNeeded } from "./mailbox-cursor.js";
import { isMailboxNotOnServer } from "./mailbox-presence.js";
import type {
	FlatMailboxInfo,
	IImapConnection,
	ImapNamespaces,
	MailboxSyncResult,
} from "./types.js";

// Type for namespace type values
type NamespaceTypeValue = (typeof NamespaceType)[keyof typeof NamespaceType];
type MailboxSpecialUseValue =
	(typeof MailboxSpecialUse)[keyof typeof MailboxSpecialUse];

/**
 * Compare two unordered special-use lists/sets for equality. Treats `undefined`
 * and an empty array as equivalent (a mailbox with no flags).
 */
const areSpecialUseSetsEqual = (
	a: readonly MailboxSpecialUseValue[] | undefined,
	b: readonly MailboxSpecialUseValue[] | undefined,
): boolean => {
	const aArr = a ?? [];
	const bArr = b ?? [];
	if (aArr.length !== bArr.length) return false;
	const aSet = new Set<string>(aArr);
	for (const value of bArr) {
		if (!aSet.has(value)) return false;
	}
	return true;
};

/**
 * The role a folder's own leaf name is most conventionally for, read from the
 * one hint table every special-folder lookup shares (`@remit/data-ports`,
 * #837). A name that several roles list goes to the role that ranks it highest,
 * so `All Mail` is an All folder rather than a lookalike of Archive.
 *
 * A second copy of these names lived here, and it is the one that could destroy
 * something: it still called `Deleted` and `Bin` Trash names, which #843 dropped
 * precisely because they are ordinary folders a user keeps mail in — and this
 * lookup does not merely skip a folder, it deletes the row and everything the
 * client can see in it.
 */
const roleForFolderName = (
	name: string,
): CanonicalMailboxRoleValue | undefined => {
	let best: { role: CanonicalMailboxRoleValue; rank: number } | undefined;
	for (const role of CANONICAL_ROLES) {
		const rank = ROLE_NAME_HINTS[role]?.indexOf(name) ?? -1;
		if (rank < 0) continue;
		if (!best || rank < best.rank) best = { role, rank };
	}
	return best?.role;
};

/**
 * Account info needed for mailbox sync
 */
export interface SyncAccountInfo {
	accountId: string;
}

/**
 * Logger interface for MailboxSyncService.
 *
 * `info` is reserved here for the three mailbox lifecycle events — created,
 * updated, deleted — and is the argued exception to `plugins/no-logger-info.grit`
 * that the rest of this repo writes as a suppression. (The plugin matches the
 * bare `logger` identifier, so it does not see an injected logger; the reasoning
 * is written out instead of being silently absent.) A folder disappearing from
 * someone's mail is destructive and irreversible from this service's side, and
 * the only record that this process did it is the line it writes. That must not
 * sit below the default threshold.
 *
 * Everything else this service has to say — a special-use flag it synced, a
 * duplicate folder it skipped — is a routine trace and goes to `debug`.
 */
export interface MailboxSyncLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	debug(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Service for synchronizing mailbox metadata between IMAP and the data backend.
 */
export class MailboxSyncService {
	private mailboxService: IMailboxRepository;
	private specialUseService: IMailboxSpecialUseRepository;
	private log: MailboxSyncLogger;

	// Required, with no no-op default: the lines below are the only record that a
	// mailbox was created or destroyed, and a default would let the next call site
	// lose them with no error and no failing test.
	constructor(
		mailboxService: IMailboxRepository,
		specialUseService: IMailboxSpecialUseRepository,
		logger: MailboxSyncLogger,
	) {
		this.mailboxService = mailboxService;
		this.specialUseService = specialUseService;
		this.log = logger;
	}

	/**
	 * Sync all mailboxes for an account from IMAP server
	 *
	 * @param account - Account info including accountId
	 * @param connection - Active IMAP connection
	 */
	syncMailboxes = async (
		account: SyncAccountInfo,
		connection: IImapConnection,
	): Promise<MailboxSyncResult> => {
		const result: MailboxSyncResult = {
			created: 0,
			updated: 0,
			deleted: 0,
		};

		// Get existing mailboxes from database
		const existingMailboxes = await this.getAllMailboxes(account.accountId);
		const existingByPath = new Map(
			existingMailboxes.map((m) => [m.fullPath, m]),
		);

		// Get namespaces and mailboxes from IMAP
		const namespaces = await connection.getNamespaces();
		const remoteMailboxes = await this.fetchAllMailboxes(
			connection,
			namespaces,
		);

		// Build a map of special-use designations claimed by mailboxes with IMAP attributes.
		// Used to:
		//  1. Skip duplicate folders (e.g., "Trash" vs "[Gmail]/Trash") at sync time.
		//  2. Skip duplicate localized folders (e.g., "Sent" vs "Verzonden items") when one
		//     of them carries the IMAP \Sent flag — issue #194.
		const claimedSpecialUse = this.buildSpecialUseMap(remoteMailboxes);

		// Track which paths we've seen from remote
		const seenPaths = new Set<string>();

		// Process each remote mailbox (concurrency 3 for IMAP pipelining)
		await pMap(
			remoteMailboxes,
			async (mailboxInfo) => {
				// Skip non-selectable mailboxes (container folders that can't hold messages)
				if (isNoSelect(mailboxInfo.attributes)) {
					// Mark as seen so we don't try to delete again in cleanup loop
					seenPaths.add(mailboxInfo.fullPath);
					// If this mailbox exists in DB, delete it
					const existing = existingByPath.get(mailboxInfo.fullPath);
					if (existing) {
						await this.mailboxService.delete(
							account.accountId,
							existing.mailboxId,
						);
						this.log.info(
							{
								mailboxId: existing.mailboxId,
								fullPath: existing.fullPath,
								reason: "non-selectable",
							},
							"Deleted mailbox",
						);
						result.deleted++;
					}
					return;
				}

				// Skip duplicate special-use folders (e.g., "Trash" when "[Gmail]/Trash" exists)
				if (this.isDuplicateSpecialUse(mailboxInfo, claimedSpecialUse)) {
					seenPaths.add(mailboxInfo.fullPath);
					const existing = existingByPath.get(mailboxInfo.fullPath);
					if (existing) {
						await this.specialUseService.deleteByMailboxId(existing.mailboxId);
						await this.mailboxService.delete(
							account.accountId,
							existing.mailboxId,
						);
						this.log.info(
							{
								mailboxId: existing.mailboxId,
								fullPath: existing.fullPath,
								reason: "duplicate-special-use",
							},
							"Deleted mailbox",
						);
						result.deleted++;
					}
					return;
				}

				seenPaths.add(mailboxInfo.fullPath);
				const existing = existingByPath.get(mailboxInfo.fullPath);

				if (existing) {
					// A folder at either end of its lifecycle is left alone: the worker
					// that establishes or removes it writes its own identity back, and
					// reading its status meanwhile is work whose only possible outcome is
					// a failure that fails this whole account's fan-out with it.
					if (
						existing.syncStatus === MailboxSyncStatus.pending ||
						existing.syncStatus === MailboxSyncStatus.deleting
					) {
						return;
					}
					// The folder set can change under this sweep. A delete that lands
					// between the LIST above and this mailbox's STATUS fails on the
					// server or on the row, and that would abort the enumeration of every
					// other folder and the SYNC_MESSAGES fan-out behind it — on a
					// per-account FIFO queue, for the whole visibility window (issue
					// #339). One folder leaving is not a failed account sync. Anything
					// else still propagates.
					const updated = await this.updateMailbox(
						account.accountId,
						existing,
						mailboxInfo,
						connection,
					).catch(async (error: unknown) => {
						// The read only classifies the failure in hand; one that cannot
						// answer must not replace it.
						const gone = await isMailboxNotOnServer(
							this.mailboxService,
							account.accountId,
							existing.mailboxId,
						).catch(() => false);
						if (gone) return null;
						throw error;
					});
					if (updated) {
						result.updated++;
					}
				} else {
					await this.createMailbox(
						account.accountId,
						mailboxInfo,
						namespaces,
						connection,
					);
					result.created++;
				}
			},
			{ concurrency: 3 },
		);

		// Handle deleted mailboxes (exist in DB but not on server)
		for (const existing of existingMailboxes) {
			if (seenPaths.has(existing.fullPath)) continue;
			// A `pending` row is a folder the user just created (or renamed) whose
			// MAILBOX_CREATE/RENAME has not yet reached the server, so its absence
			// from the LIST is expected, not a server-side deletion. Deleting it
			// races the create: the row vanishes, then MAILBOX_CREATE fails with
			// NotFoundError trying to mark it synced, and — sharing this account's
			// mailboxes FIFO group — that un-acked failure stalls every later
			// mailbox sync for the queue's whole visibility window (#290). Leave
			// pending rows to the create/rename flow that owns them.
			if (existing.syncStatus === MailboxSyncStatus.pending) continue;
			await this.mailboxService.delete(account.accountId, existing.mailboxId);
			this.log.info(
				{
					mailboxId: existing.mailboxId,
					fullPath: existing.fullPath,
					reason: "not-on-server",
				},
				"Deleted mailbox",
			);
			result.deleted++;
		}

		return result;
	};

	/**
	 * Sync metadata for a specific mailbox
	 *
	 * Opens the mailbox to get current UID validity, counts, etc.
	 */
	syncMailboxMetadata = async (
		accountId: string,
		mailboxId: string,
		connection: IImapConnection,
	): Promise<MailboxItem> => {
		const mailbox = await this.mailboxService.get(accountId, mailboxId);
		const boxStatus = await connection.openBox(mailbox.fullPath, true);

		// See `updateMailbox` above for why this trips (not skips) on a
		// UIDVALIDITY change instead of silently overwriting the stored value.
		const uidValidityChanged = mailbox.uidValidity !== boxStatus.uidvalidity;
		const cursorTrip =
			uidValidityChanged && !isCursorRebuildNeeded(mailbox.cursorState)
				? { cursorState: MailboxCursorState.cursor_invalid }
				: {};

		return this.mailboxService
			.update(accountId, mailboxId, {
				uidValidity: boxStatus.uidvalidity,
				uidNext: boxStatus.uidnext,
				messageCount: boxStatus.messages.total,
				...cursorTrip,
			})
			.finally(() => connection.closeBox(false));
	};

	/**
	 * Get all mailboxes for an account, handling pagination
	 */
	private getAllMailboxes = async (
		accountId: string,
	): Promise<MailboxItem[]> => {
		const allMailboxes: MailboxItem[] = [];
		let continuationToken: string | undefined;

		do {
			const result = await this.mailboxService.listByAccount(accountId, {
				continuationToken,
			});
			allMailboxes.push(...result.items);
			continuationToken = result.continuationToken;
		} while (continuationToken);

		return allMailboxes;
	};

	/**
	 * Fetch all mailboxes from IMAP server across all namespaces.
	 * Uses listMailboxes() to preserve original paths from the server.
	 */
	private fetchAllMailboxes = async (
		connection: IImapConnection,
		namespaces: ImapNamespaces,
	): Promise<
		Array<
			FlatMailboxInfo & {
				namespaceType: NamespaceTypeValue;
				namespacePrefix: string;
			}
		>
	> => {
		// Flatten all namespaces with their types
		const allNamespaces = [
			...namespaces.personal.map((ns) => ({
				type: NamespaceType.Personal as NamespaceTypeValue,
				prefix: ns.prefix || "",
			})),
			...namespaces.other.map((ns) => ({
				type: NamespaceType.OtherUsers as NamespaceTypeValue,
				prefix: ns.prefix || "",
			})),
			...namespaces.shared.map((ns) => ({
				type: NamespaceType.Shared as NamespaceTypeValue,
				prefix: ns.prefix || "",
			})),
		];

		// Fetch mailboxes for each namespace and flatten
		const nestedResults = await Promise.all(
			allNamespaces.map(async ({ type, prefix }) => {
				const mailboxes = await connection.listMailboxes(prefix);
				return mailboxes.map((mailbox) => ({
					...mailbox,
					namespaceType: type,
					namespacePrefix: prefix,
				}));
			}),
		);
		const results = nestedResults.flat();

		// INBOX is implicit in IMAP and may not be returned by LIST commands
		const hasInbox = results.some((m) => m.fullPath.toUpperCase() === "INBOX");
		if (!hasInbox) {
			const nsDelimiter = namespaces.personal[0]?.delimiter;
			const delimiter = typeof nsDelimiter === "string" ? nsDelimiter : "/";
			results.unshift({
				fullPath: "INBOX",
				name: "INBOX",
				delimiter,
				attributes: [],
				parentPath: null,
				namespaceType: NamespaceType.Personal,
				namespacePrefix: "",
			});
		}

		return results;
	};

	/**
	 * Create a new mailbox in the database
	 */
	private createMailbox = async (
		accountId: string,
		mailboxInfo: FlatMailboxInfo & {
			namespaceType: NamespaceTypeValue;
			namespacePrefix: string;
		},
		_namespaces: ImapNamespaces,
		connection: IImapConnection,
	): Promise<MailboxItem> => {
		// Fetch mailbox status using STATUS command (doesn't require SELECT/EXAMINE)
		// This gets us message counts including unseen without opening the mailbox
		const status = await connection.getMailboxStatus(mailboxInfo.fullPath);

		// Parse special-use attributes (RFC 6154) up front so the row stores a
		// denormalized copy. Frontends list mailboxes by account; threading a join
		// through MailboxSpecialUseEntry per row would be O(N) extra round-trips.
		const parsed = parseImapAttributes(mailboxInfo.attributes);

		const input: CreateMailboxInput = {
			accountId,
			namespaceType: mailboxInfo.namespaceType,
			namespacePrefix: mailboxInfo.namespacePrefix,
			hierarchyDelimiter: mailboxInfo.delimiter,
			fullPath: mailboxInfo.fullPath,
			uidValidity: status.uidValidity,
			uidNext: status.uidNext,
			// The message-sync cursor, not a status projection: it records how
			// far THIS mailbox's messages have been applied, and nothing has
			// been. Seeding it from the server's current HIGHESTMODSEQ would
			// declare an unsynced folder already caught up and skip every
			// message in it. Message sync seeds it once it has enumerated the
			// folder.
			highestModseq: "0",
			messageCount: status.messages,
			unseenCount: status.unseen,
			deletedCount: status.deletedCount,
			totalSize: 0,
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			lastMessageSyncAt: 0,
			specialUse: parsed.specialUse.length > 0 ? parsed.specialUse : undefined,
			// parentMailboxId would need to be resolved from parentPath
		};

		const mailbox = await this.mailboxService.create(input);

		// Keep the MailboxSpecialUseEntry table in sync — every backend and worker
		// special-folder lookup reads it through MailboxSpecialUseRepo. Denormalized
		// copy on Mailbox is the read-side optimization, the entries remain the
		// authoritative join source for cross-mailbox lookups.
		if (parsed.specialUse.length > 0) {
			await this.specialUseService.createMany(
				mailbox.mailboxId,
				parsed.specialUse,
			);
			this.log.info(
				{
					mailboxId: mailbox.mailboxId,
					fullPath: mailboxInfo.fullPath,
					specialUse: parsed.specialUse,
				},
				"Created mailbox",
			);
		} else {
			this.log.info(
				{ mailboxId: mailbox.mailboxId, fullPath: mailboxInfo.fullPath },
				"Created mailbox",
			);
		}

		return mailbox;
	};

	/**
	 * Update an existing mailbox with fresh data.
	 * Skips DB write if nothing has changed.
	 *
	 * @returns The updated mailbox, or null if skipped due to no changes
	 */
	private updateMailbox = async (
		accountId: string,
		existing: MailboxItem,
		mailboxInfo: FlatMailboxInfo,
		connection: IImapConnection,
	): Promise<MailboxItem | null> => {
		// Fetch mailbox status using STATUS command (doesn't require SELECT/EXAMINE)
		const status = await connection.getMailboxStatus(mailboxInfo.fullPath);

		const parsed = parseImapAttributes(mailboxInfo.attributes);
		const specialUseChanged = !areSpecialUseSetsEqual(
			existing.specialUse,
			parsed.specialUse,
		);

		// UIDVALIDITY detection (#1272): this STATUS-based sweep persists a fresh
		// uidValidity below regardless (harmless — it never touches a stored UID),
		// but if the server's value disagrees with what's stored and the mailbox
		// was still `normal`, the axis just changed. Trip the cursor here so the
		// message-sync/flag-push/move/body-fetch paths pause outbound IMAP until
		// the rebuild resolves it, instead of silently overwriting the old value
		// and erasing the only evidence a bump happened.
		const uidValidityChanged = existing.uidValidity !== status.uidValidity;
		const cursorTrip =
			uidValidityChanged && !isCursorRebuildNeeded(existing.cursorState)
				? { cursorState: MailboxCursorState.cursor_invalid }
				: {};

		// Check if anything actually changed
		const hasChanges =
			existing.uidNext !== status.uidNext ||
			existing.uidValidity !== status.uidValidity ||
			existing.messageCount !== status.messages ||
			existing.unseenCount !== status.unseen ||
			existing.deletedCount !== status.deletedCount ||
			specialUseChanged;

		// Sync special-use attributes (handles migration of existing mailboxes)
		await this.syncSpecialUseAttributes(existing.mailboxId, mailboxInfo);

		if (!hasChanges) {
			return null;
		}

		// Debug: log what changed
		const changes: string[] = [];
		if (existing.uidNext !== status.uidNext)
			changes.push(`uidNext: ${existing.uidNext} -> ${status.uidNext}`);
		if (existing.uidValidity !== status.uidValidity)
			changes.push(
				`uidValidity: ${existing.uidValidity} -> ${status.uidValidity}`,
			);
		if (existing.messageCount !== status.messages)
			changes.push(
				`messageCount: ${existing.messageCount} -> ${status.messages}`,
			);
		if (existing.unseenCount !== status.unseen)
			changes.push(`unseenCount: ${existing.unseenCount} -> ${status.unseen}`);
		if (existing.deletedCount !== status.deletedCount)
			changes.push(
				`deletedCount: ${existing.deletedCount} -> ${status.deletedCount}`,
			);
		if (specialUseChanged)
			changes.push(
				`specialUse: [${(existing.specialUse ?? []).join(",")}] -> [${parsed.specialUse.join(",")}]`,
			);

		this.log.info(
			{
				mailboxId: existing.mailboxId,
				fullPath: mailboxInfo.fullPath,
				changes,
			},
			"Updating mailbox",
		);

		// Update mailbox with fresh status. ElectroDB rejects empty sets, so we
		// pass undefined when no flags are present rather than [].
		return this.mailboxService.update(accountId, existing.mailboxId, {
			hierarchyDelimiter: mailboxInfo.delimiter,
			uidValidity: status.uidValidity,
			uidNext: status.uidNext,
			// `highestModseq` is deliberately absent: it is message sync's
			// cursor over this mailbox's own applied changes, and overwriting it
			// with the server's current value here would step it over every
			// change message sync had not yet applied.
			messageCount: status.messages,
			unseenCount: status.unseen,
			deletedCount: status.deletedCount,
			specialUse: parsed.specialUse.length > 0 ? parsed.specialUse : undefined,
			...cursorTrip,
		});
	};

	/**
	 * Sync special-use attributes for a mailbox.
	 * Creates entries if they don't exist, updates if changed.
	 */
	private syncSpecialUseAttributes = async (
		mailboxId: string,
		mailboxInfo: FlatMailboxInfo,
	): Promise<void> => {
		const parsed = parseImapAttributes(mailboxInfo.attributes);
		const existingEntries =
			await this.specialUseService.listByMailboxId(mailboxId);

		const existingSpecialUses = new Set(
			existingEntries.map((e) => e.specialUse),
		);
		const newSpecialUses = new Set(parsed.specialUse);

		// Check if sets are equal
		const areEqual =
			existingSpecialUses.size === newSpecialUses.size &&
			[...existingSpecialUses].every((use) => newSpecialUses.has(use));

		if (areEqual) return;

		// Delete and recreate (simpler than diff)
		if (existingEntries.length > 0) {
			await this.specialUseService.deleteByMailboxId(mailboxId);
		}

		if (parsed.specialUse.length > 0) {
			await this.specialUseService.createMany(mailboxId, parsed.specialUse);
			this.log.debug(
				{ fullPath: mailboxInfo.fullPath, specialUse: parsed.specialUse },
				"Synced special-use",
			);
		}
	};

	/**
	 * Build a map of special-use designations to mailbox paths.
	 * Only includes mailboxes that have the IMAP special-use attribute.
	 */
	private buildSpecialUseMap = (
		mailboxes: FlatMailboxInfo[],
	): Map<MailboxSpecialUseValue, string> => {
		const map = new Map<MailboxSpecialUseValue, string>();

		for (const mailbox of mailboxes) {
			const parsed = parseImapAttributes(mailbox.attributes);
			for (const specialUse of parsed.specialUse) {
				// First mailbox with this special-use wins (usually the canonical one)
				if (!map.has(specialUse)) {
					map.set(specialUse, mailbox.fullPath);
				}
			}
		}

		return map;
	};

	/**
	 * Check if a mailbox is a duplicate special-use folder.
	 * A folder is considered duplicate if:
	 * 1. Its name matches a common special-use folder name (e.g., "Trash")
	 * 2. It does NOT have the IMAP special-use attribute
	 * 3. Another folder already claimed that special-use designation
	 */
	private isDuplicateSpecialUse = (
		mailbox: FlatMailboxInfo,
		claimedSpecialUse: Map<MailboxSpecialUseValue, string>,
	): boolean => {
		// Get the folder name (last segment of path)
		const folderName = mailbox.fullPath.split(mailbox.delimiter).pop() ?? "";
		const normalizedName = folderName.toLowerCase();

		// Check if this folder name is a conventional name for a role
		const role = roleForFolderName(normalizedName);
		if (!role) {
			return false; // Not a special-use folder name
		}

		const expectedSpecialUse = ROLE_SPECIAL_USE[role];
		if (!expectedSpecialUse) {
			return false; // The role has no SPECIAL-USE flag to be a duplicate of
		}

		// Check if this mailbox has the special-use attribute
		const parsed = parseImapAttributes(mailbox.attributes);
		if (parsed.specialUse.some((use) => use === expectedSpecialUse)) {
			return false; // This IS the canonical folder
		}

		// Check if another folder already claimed this special-use
		const claimed = [...claimedSpecialUse].find(
			([specialUse]) => specialUse === expectedSpecialUse,
		);
		if (!claimed) {
			return false; // No other folder has this special-use
		}

		// This is a duplicate - another folder has the attribute
		this.log.debug(
			{
				fullPath: mailbox.fullPath,
				claimedPath: claimed[1],
				specialUse: expectedSpecialUse,
			},
			"Skipping duplicate folder",
		);
		return true;
	};
}
