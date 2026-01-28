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
import type {
	FlatMailboxInfo,
	IImapConnection,
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

		// Track which paths we've seen from remote
		const seenPaths = new Set<string>();

		// Process each remote mailbox
		for (const mailboxInfo of remoteMailboxes) {
			// Skip non-selectable mailboxes (container folders that can't hold messages)
			if (isNoSelect(mailboxInfo.attributes)) {
				// Mark as seen so we don't try to delete again in cleanup loop
				seenPaths.add(mailboxInfo.fullPath);
				// If this mailbox exists in DB, delete it
				const existing = existingByPath.get(mailboxInfo.fullPath);
				if (existing) {
					await this.mailboxService.delete(existing.mailboxId);
					console.info(
						`Deleted non-selectable mailbox: ${existing.mailboxId} (${existing.fullPath})`,
					);
					result.deleted++;
				}
				continue;
			}

			seenPaths.add(mailboxInfo.fullPath);
			const existing = existingByPath.get(mailboxInfo.fullPath);

			if (existing) {
				await this.updateMailbox(existing, mailboxInfo, connection);
				result.updated++;
			} else {
				await this.createMailbox(
					account.accountId,
					mailboxInfo,
					namespaces,
					connection,
				);
				result.created++;
			}
		}

		// Handle deleted mailboxes (exist in DB but not on server)
		for (const existing of existingMailboxes) {
			if (!seenPaths.has(existing.fullPath)) {
				await this.mailboxService.delete(existing.mailboxId);
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
		mailboxId: string,
		connection: IImapConnection,
	): Promise<MailboxItem> => {
		const mailbox = await this.mailboxService.get(mailboxId);
		const boxStatus = await connection.openBox(mailbox.fullPath, true);

		return this.mailboxService
			.update(mailboxId, {
				uidValidity: boxStatus.uidvalidity,
				uidNext: boxStatus.uidnext,
				messageCount: boxStatus.messages.total,
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

		const input: CreateMailboxInput = {
			accountId,
			namespaceType: mailboxInfo.namespaceType,
			namespacePrefix: mailboxInfo.namespacePrefix,
			hierarchyDelimiter: mailboxInfo.delimiter,
			fullPath: mailboxInfo.fullPath,
			uidValidity: status.uidValidity,
			uidNext: status.uidNext,
			messageCount: status.messages,
			unseenCount: status.unseen,
			deletedCount: 0,
			totalSize: 0,
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			lastMessageSyncAt: 0,
			// parentMailboxId would need to be resolved from parentPath
		};

		// TODO: Store attributes and special-use entries in separate entities
		// For now, we only create the Mailbox entity

		const mailbox = await this.mailboxService.create(input);

		console.info(
			`Created mailbox: ${mailbox.mailboxId} (${mailboxInfo.fullPath})`,
		);

		return mailbox;
	};

	/**
	 * Update an existing mailbox with fresh data
	 */
	private updateMailbox = async (
		existing: MailboxItem,
		mailboxInfo: FlatMailboxInfo,
		connection: IImapConnection,
	): Promise<MailboxItem> => {
		console.info(
			`Updating mailbox: ${existing.mailboxId} (${mailboxInfo.fullPath})`,
		);

		// Fetch mailbox status using STATUS command (doesn't require SELECT/EXAMINE)
		const status = await connection.getMailboxStatus(mailboxInfo.fullPath);

		// Update mailbox with fresh status
		return this.mailboxService.update(existing.mailboxId, {
			hierarchyDelimiter: mailboxInfo.delimiter,
			uidValidity: status.uidValidity,
			uidNext: status.uidNext,
			messageCount: status.messages,
			unseenCount: status.unseen,
		});
	};
}
