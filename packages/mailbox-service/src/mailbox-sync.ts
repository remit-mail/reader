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
	MailboxCursorState,
	MailboxSpecialUse,
	NamespaceType,
} from "@remit/domain-enums";
import pMap from "p-map";
import { isNoSelect, parseImapAttributes } from "./attribute-mapper.js";
import { isCursorRebuildNeeded } from "./mailbox-cursor.js";
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
 * Map common folder names to their expected special-use designation.
 * Used to detect duplicate folders (e.g., "Trash" vs "[Gmail]/Trash").
 */
const FOLDER_NAME_TO_SPECIAL_USE: Record<string, MailboxSpecialUseValue> = {
	trash: MailboxSpecialUse.Trash,
	"deleted items": MailboxSpecialUse.Trash,
	deleted: MailboxSpecialUse.Trash,
	bin: MailboxSpecialUse.Trash,
	drafts: MailboxSpecialUse.Drafts,
	draft: MailboxSpecialUse.Drafts,
	sent: MailboxSpecialUse.Sent,
	"sent items": MailboxSpecialUse.Sent,
	"sent mail": MailboxSpecialUse.Sent,
	junk: MailboxSpecialUse.Junk,
	spam: MailboxSpecialUse.Junk,
	archive: MailboxSpecialUse.Archive,
	archives: MailboxSpecialUse.Archive,
};

/**
 * Account info needed for mailbox sync
 */
export interface SyncAccountInfo {
	accountId: string;
}

/**
 * Service for synchronizing mailbox metadata between IMAP and the data backend.
 */
export class MailboxSyncService {
	private mailboxService: IMailboxRepository;
	private specialUseService: IMailboxSpecialUseRepository;

	constructor(
		mailboxService: IMailboxRepository,
		specialUseService: IMailboxSpecialUseRepository,
	) {
		this.mailboxService = mailboxService;
		this.specialUseService = specialUseService;
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
						console.info(
							`Deleted non-selectable mailbox: ${existing.mailboxId} (${existing.fullPath})`,
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
						console.info(
							`Deleted duplicate special-use mailbox: ${existing.mailboxId} (${existing.fullPath})`,
						);
						result.deleted++;
					}
					return;
				}

				seenPaths.add(mailboxInfo.fullPath);
				const existing = existingByPath.get(mailboxInfo.fullPath);

				if (existing) {
					const updated = await this.updateMailbox(
						account.accountId,
						existing,
						mailboxInfo,
						connection,
					);
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
			if (!seenPaths.has(existing.fullPath)) {
				await this.mailboxService.delete(account.accountId, existing.mailboxId);
				console.info(
					`Deleted mailbox: ${existing.mailboxId} (${existing.fullPath})`,
				);
				result.deleted++;
			}
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
			highestModseq: status.highestModseq,
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

		// Keep the MailboxSpecialUseEntry table in sync — other services (e.g.
		// MessageMoveService.findTrashMailbox) still query by entry. Denormalized
		// copy on Mailbox is the read-side optimization, the entries remain the
		// authoritative join source for cross-mailbox lookups.
		if (parsed.specialUse.length > 0) {
			await this.specialUseService.createMany(
				mailbox.mailboxId,
				parsed.specialUse,
			);
			console.info(
				`Created mailbox: ${mailbox.mailboxId} (${mailboxInfo.fullPath}) [special-use: ${parsed.specialUse.join(", ")}]`,
			);
		} else {
			console.info(
				`Created mailbox: ${mailbox.mailboxId} (${mailboxInfo.fullPath})`,
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
			(status.highestModseq > 0 &&
				existing.highestModseq !== status.highestModseq) ||
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
		if (
			status.highestModseq > 0 &&
			existing.highestModseq !== status.highestModseq
		)
			changes.push(
				`highestModseq: ${existing.highestModseq} -> ${status.highestModseq}`,
			);
		if (specialUseChanged)
			changes.push(
				`specialUse: [${(existing.specialUse ?? []).join(",")}] -> [${parsed.specialUse.join(",")}]`,
			);

		console.info(
			`Updating mailbox: ${existing.mailboxId} (${mailboxInfo.fullPath}) [${changes.join(", ")}]`,
		);

		// Update mailbox with fresh status. ElectroDB rejects empty sets, so we
		// pass undefined when no flags are present rather than [].
		return this.mailboxService.update(accountId, existing.mailboxId, {
			hierarchyDelimiter: mailboxInfo.delimiter,
			uidValidity: status.uidValidity,
			uidNext: status.uidNext,
			highestModseq: status.highestModseq,
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
			console.info(
				`Synced special-use for ${mailboxInfo.fullPath}: ${parsed.specialUse.join(", ")}`,
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

		// Check if this folder name maps to a special-use designation
		const expectedSpecialUse = FOLDER_NAME_TO_SPECIAL_USE[normalizedName];
		if (!expectedSpecialUse) {
			return false; // Not a special-use folder name
		}

		// Check if this mailbox has the special-use attribute
		const parsed = parseImapAttributes(mailbox.attributes);
		if (parsed.specialUse.includes(expectedSpecialUse)) {
			return false; // This IS the canonical folder
		}

		// Check if another folder already claimed this special-use
		const claimedPath = claimedSpecialUse.get(expectedSpecialUse);
		if (!claimedPath) {
			return false; // No other folder has this special-use
		}

		// This is a duplicate - another folder has the attribute
		console.info(
			`Skipping duplicate folder "${mailbox.fullPath}" - "${claimedPath}" has \\${expectedSpecialUse} attribute`,
		);
		return true;
	};
}
