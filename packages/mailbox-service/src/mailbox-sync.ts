/**
 * Mailbox synchronization service
 *
 * Orchestrates syncing mailbox data from IMAP server to DynamoDB
 */

import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
	type CreateMailboxInput,
	type MailboxItem,
	MailboxService,
} from "@remit/remit-electrodb-service";
import { NamespaceType } from "@remit/domain-enums";
import { isNoSelect } from "./attribute-mapper.js";
import type { ImapConnection } from "./imap-connection.js";
import type {
	FlatMailboxInfo,
	ImapBoxStatus,
	ImapNamespaces,
	MailboxSyncResult,
} from "./types.js";

// Type for namespace type values
type NamespaceTypeValue = (typeof NamespaceType)[keyof typeof NamespaceType];

/**
 * Configuration for MailboxSyncService
 */
export interface MailboxSyncConfig {
	client: DynamoDBClient;
	table: string;
}

/**
 * Account info needed for mailbox sync
 */
export interface SyncAccountInfo {
	accountId: string;
}

/**
 * Service for synchronizing mailbox metadata between IMAP and DynamoDB
 */
export class MailboxSyncService {
	private mailboxService: MailboxService;

	constructor(config: MailboxSyncConfig) {
		this.mailboxService = new MailboxService({
			client: config.client,
			table: config.table,
		});
	}

	/**
	 * Sync all mailboxes for an account from IMAP server
	 *
	 * @param account - Account info including accountId
	 * @param connection - Active IMAP connection
	 */
	syncMailboxes = async (
		account: SyncAccountInfo,
		connection: ImapConnection,
	): Promise<MailboxSyncResult> => {
		const result: MailboxSyncResult = {
			created: 0,
			updated: 0,
			deleted: 0,
			errors: [],
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

		// Track which paths we've seen from remote
		const seenPaths = new Set<string>();

		// Process each remote mailbox
		for (const mailboxInfo of remoteMailboxes) {
			seenPaths.add(mailboxInfo.fullPath);
			const existing = existingByPath.get(mailboxInfo.fullPath);

			try {
				if (existing) {
					// Update existing mailbox
					await this.updateMailbox(existing, mailboxInfo, connection);
					result.updated++;
				} else {
					// Create new mailbox
					await this.createMailbox(
						account.accountId,
						mailboxInfo,
						namespaces,
						connection,
					);
					result.created++;
				}
			} catch (error) {
				result.errors.push({
					mailboxPath: mailboxInfo.fullPath,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		// Handle deleted mailboxes (exist in DB but not on server)
		for (const existing of existingMailboxes) {
			if (!seenPaths.has(existing.fullPath)) {
				try {
					await this.mailboxService.delete(existing.mailboxId);
					result.deleted++;
				} catch (error) {
					result.errors.push({
						mailboxPath: existing.fullPath,
						error: error instanceof Error ? error.message : String(error),
					});
				}
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
		mailboxId: string,
		connection: ImapConnection,
	): Promise<MailboxItem> => {
		const mailbox = await this.mailboxService.get(mailboxId);

		// Skip non-selectable mailboxes
		// We can't open these to get metadata
		// The Mailbox entity doesn't store attributes directly,
		// but we check if we can open it
		let boxStatus: ImapBoxStatus;
		try {
			boxStatus = await connection.openBox(mailbox.fullPath, true);
		} catch (_error) {
			// If we can't open the mailbox, it might be non-selectable
			// Just return the current state
			return mailbox;
		}

		try {
			// Update mailbox with fresh metadata
			return await this.mailboxService.update(mailboxId, {
				uidValidity: boxStatus.uidvalidity,
				uidNext: boxStatus.uidnext,
				messageCount: boxStatus.messages.total,
				// Note: unseen count requires a STATUS command or search
				// For now we don't update it here
			});
		} finally {
			await connection.closeBox(false);
		}
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
	 * Fetch all mailboxes from IMAP server across all namespaces
	 */
	private fetchAllMailboxes = async (
		connection: ImapConnection,
		namespaces: ImapNamespaces,
	): Promise<
		Array<
			FlatMailboxInfo & {
				namespaceType: NamespaceTypeValue;
				namespacePrefix: string;
			}
		>
	> => {
		const results: Array<
			FlatMailboxInfo & {
				namespaceType: NamespaceTypeValue;
				namespacePrefix: string;
			}
		> = [];

		// Process each namespace type
		const namespaceTypes: Array<{
			type: NamespaceTypeValue;
			namespaces: typeof namespaces.personal;
		}> = [
			{ type: NamespaceType.Personal, namespaces: namespaces.personal },
			{ type: NamespaceType.OtherUsers, namespaces: namespaces.other },
			{ type: NamespaceType.Shared, namespaces: namespaces.shared },
		];

		for (const { type, namespaces: nsList } of namespaceTypes) {
			for (const ns of nsList) {
				const prefix = ns.prefix || "";
				try {
					const boxes = await connection.getBoxes(prefix);
					const flattened = connection.flattenBoxes(boxes);

					for (const mailbox of flattened) {
						results.push({
							...mailbox,
							namespaceType: type,
							namespacePrefix: prefix,
						});
					}
				} catch (error) {
					// Skip namespaces we can't access
					console.warn(
						`Failed to list mailboxes for namespace ${prefix}:`,
						error,
					);
				}
			}
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
		connection: ImapConnection,
	): Promise<MailboxItem> => {
		// Parse attributes - unused for now
		// const { attributes, specialUse } = parseImapAttributes(
		// 	mailboxInfo.attributes,
		// );

		// Get initial metadata by opening the mailbox (if selectable)
		let uidValidity = 1;
		let uidNext = 1;
		let messageCount = 0;

		if (!isNoSelect(mailboxInfo.attributes)) {
			try {
				const boxStatus = await connection.openBox(mailboxInfo.fullPath, true);
				uidValidity = boxStatus.uidvalidity;
				uidNext = boxStatus.uidnext;
				messageCount = boxStatus.messages.total;
				await connection.closeBox(false);
			} catch (error) {
				// Failed to open mailbox, use defaults
				console.warn(`Could not open mailbox ${mailboxInfo.fullPath}:`, error);
			}
		}

		const input: CreateMailboxInput = {
			accountId,
			namespaceType: mailboxInfo.namespaceType,
			namespacePrefix: mailboxInfo.namespacePrefix,
			hierarchyDelimiter: mailboxInfo.delimiter,
			fullPath: mailboxInfo.fullPath,
			uidValidity,
			uidNext,
			messageCount,
			unseenCount: 0,
			deletedCount: 0,
			totalSize: 0,
			lastSyncUid: 0,
			lastMessageSyncAt: 0,
			// parentMailboxId would need to be resolved from parentPath
		};

		// TODO: Store attributes and special-use entries in separate entities
		// For now, we only create the Mailbox entity

		return this.mailboxService.create(input);
	};

	/**
	 * Update an existing mailbox with fresh data
	 */
	private updateMailbox = async (
		existing: MailboxItem,
		mailboxInfo: FlatMailboxInfo,
		connection: ImapConnection,
	): Promise<MailboxItem> => {
		// Check if delimiter changed (shouldn't happen, but handle it)
		if (existing.hierarchyDelimiter !== mailboxInfo.delimiter) {
			await this.mailboxService.update(existing.mailboxId, {
				hierarchyDelimiter: mailboxInfo.delimiter,
			});
		}

		// Update metadata by opening the mailbox (if selectable)
		if (!isNoSelect(mailboxInfo.attributes)) {
			try {
				const boxStatus = await connection.openBox(mailboxInfo.fullPath, true);
				await this.mailboxService.update(existing.mailboxId, {
					uidValidity: boxStatus.uidvalidity,
					uidNext: boxStatus.uidnext,
					messageCount: boxStatus.messages.total,
				});
				await connection.closeBox(false);
			} catch (error) {
				// Failed to open mailbox
				console.warn(`Could not open mailbox ${mailboxInfo.fullPath}:`, error);
			}
		}

		return this.mailboxService.get(existing.mailboxId);
	};
}
