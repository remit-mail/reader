import type { SqliteBatchItem } from "../batch.js";
import { BETTER_SQLITE3_LIMITS } from "../bound-parameters.js";
import {
	openSqliteDatabases,
	type SqliteDatabasePaths,
	type SqliteStores,
	syncStores,
} from "../databases.js";
import { accountTable } from "../schema/i4-account-config.js";
import { accountSettingTable } from "../schema/i4-account-setting.js";
import { addressTable } from "../schema/i4-address.js";
import { mailboxTable } from "../schema/i4-mailbox.js";
import { mailboxLockTable } from "../schema/i4-mailbox-lock.js";
import { messageFlagPushTable } from "../schema/i4-message-flag-push.js";
import { messagePlacementMoveTable } from "../schema/i4-message-placement-move.js";
import { outboxMessageTable } from "../schema/i4-outbox-message.js";
import { quarantineTable } from "../schema/quarantine.js";
import { syncWarningTable } from "../schema/sync-warning.js";
import { threadMessageTable } from "../schema/thread-message.js";
import { SearchIndex } from "../search/thread-message-search.js";
import { inList, pairInList } from "./in-list.js";
import { deleteMessageSubtree } from "./message.js";

export interface CascadeEntity {
	entityType: string;
	key: Record<string, string>;
}

export interface CascadeDeleteLogger {
	info(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Per-message entity types. Their rows are removed with the message subtree by
 * message id, so their individually-enumerated keys are not deleted one by one —
 * the DynamoDB cascade enumerates them only because BatchWriteItem needs each
 * full key; the relational cascade deletes them set-wise by message id.
 */
const MESSAGE_CHILD_TYPES = new Set([
	"MessageFlag",
	"MessageReference",
	"EnvelopeAddress",
	"Envelope",
	"BodyPart",
	"BodyPartParameter",
	"RawMessageStorage",
]);

const KEYED_TYPES = new Set([
	"Message",
	"ThreadMessage",
	"Mailbox",
	"OutboxMessage",
	"MailboxLock",
	"AccountSetting",
	"Address",
	"Account",
	"MessagePlacementMove",
	"MessageFlagPush",
]);

const groupByType = (
	entities: CascadeEntity[],
): Map<string, Record<string, string>[]> => {
	const grouped = new Map<string, Record<string, string>[]>();
	for (const entity of entities) {
		const list = grouped.get(entity.entityType) ?? [];
		list.push(entity.key);
		grouped.set(entity.entityType, list);
	}
	return grouped;
};

/**
 * Relational equivalent of the DynamoDB BatchWriteItem cascade: delete every
 * enumerated row for an account/tenant, one batch per database — the mail rows
 * first, then the app rows, then the search documents of the deleted thread
 * messages. Every statement is keyed, so a rerun after a failure between two
 * batches deletes what is left. Message subtrees
 * (message + ten child tables) are deleted set-wise by message id; the remaining
 * entity types are deleted by their enumerated primary keys. AccountConfig is
 * never deleted here — the caller removes it last through its repository, the
 * cascade-in-progress marker.
 */
export const runDrizzleCascadeDelete = async (
	stores: SqliteStores,
	entities: CascadeEntity[],
	log: CascadeDeleteLogger,
): Promise<void> => {
	const app = stores.app.db;
	const mail = stores.mail.db;
	const grouped = groupByType(entities);

	for (const entityType of grouped.keys()) {
		if (MESSAGE_CHILD_TYPES.has(entityType)) continue;
		if (!KEYED_TYPES.has(entityType)) {
			throw new Error(`Unknown entity type in cascade: ${entityType}`);
		}
	}

	const items: SqliteBatchItem[] = [];
	const appItems: SqliteBatchItem[] = [];
	const messageIds = (grouped.get("Message") ?? []).map((k) => k.messageId);
	items.push(...deleteMessageSubtree(mail, messageIds).statements);

	const threadMessageIds = (grouped.get("ThreadMessage") ?? []).map(
		(k) => k.threadMessageId,
	);
	if (threadMessageIds.length > 0) {
		items.push(
			mail
				.delete(threadMessageTable)
				.where(inList(threadMessageTable.threadMessageId, threadMessageIds)),
		);
	}

	const mailboxIds = (grouped.get("Mailbox") ?? []).map((k) => k.mailboxId);
	if (mailboxIds.length > 0) {
		items.push(
			mail
				.delete(syncWarningTable)
				.where(inList(syncWarningTable.mailboxId, mailboxIds)),
		);
		items.push(
			mail
				.delete(mailboxTable)
				.where(inList(mailboxTable.mailboxId, mailboxIds)),
		);
	}

	const outboxMessageIds = (grouped.get("OutboxMessage") ?? []).map(
		(k) => k.outboxMessageId,
	);
	if (outboxMessageIds.length > 0) {
		items.push(
			mail
				.delete(outboxMessageTable)
				.where(inList(outboxMessageTable.outboxMessageId, outboxMessageIds)),
		);
	}

	const lockKeys = grouped.get("MailboxLock") ?? [];
	if (lockKeys.length > 0) {
		items.push(
			mail.delete(mailboxLockTable).where(
				pairInList(
					mailboxLockTable.mailboxId,
					mailboxLockTable.eventName,
					lockKeys.map((k) => [k.mailboxId, k.eventName]),
				),
			),
		);
	}

	const accountSettingIds = (grouped.get("AccountSetting") ?? []).map(
		(k) => k.accountSettingId,
	);
	if (accountSettingIds.length > 0) {
		appItems.push(
			app
				.delete(accountSettingTable)
				.where(inList(accountSettingTable.accountSettingId, accountSettingIds)),
		);
	}

	const addressIds = (grouped.get("Address") ?? []).map((k) => k.addressId);
	if (addressIds.length > 0) {
		items.push(
			mail
				.delete(addressTable)
				.where(inList(addressTable.addressId, addressIds)),
		);
	}

	const accountIds = (grouped.get("Account") ?? []).map((k) => k.accountId);
	if (accountIds.length > 0) {
		// Quarantine rows are deleted set-wise by account rather than from an
		// enumerated key, the way message subtrees are. They carry the user's
		// own folder names and parser output quoting the message, so account
		// deletion has to take them even though nothing enumerates them.
		items.push(
			mail
				.delete(quarantineTable)
				.where(inList(quarantineTable.accountId, accountIds)),
		);
		items.push(
			mail
				.delete(syncWarningTable)
				.where(inList(syncWarningTable.accountId, accountIds)),
		);
		appItems.push(
			app
				.delete(accountTable)
				.where(inList(accountTable.accountId, accountIds)),
		);
	}

	const placementMoveMessageIds = (
		grouped.get("MessagePlacementMove") ?? []
	).map((k) => k.messageId);
	if (placementMoveMessageIds.length > 0) {
		items.push(
			mail
				.delete(messagePlacementMoveTable)
				.where(
					inList(messagePlacementMoveTable.messageId, placementMoveMessageIds),
				),
		);
	}

	const flagPushKeys = grouped.get("MessageFlagPush") ?? [];
	if (flagPushKeys.length > 0) {
		items.push(
			mail.delete(messageFlagPushTable).where(
				pairInList(
					messageFlagPushTable.messageId,
					messageFlagPushTable.flagName,
					flagPushKeys.map((k) => [k.messageId, k.flagName]),
				),
			),
		);
	}
	await stores.mail.batch(items);
	await stores.app.batch(appItems);
	await new SearchIndex(mail, stores.search).sync(threadMessageIds);

	log.info({ entityCount: entities.length }, "Drizzle cascade delete complete");
};

export type CascadeDeleter = (
	entities: CascadeEntity[],
	log: CascadeDeleteLogger,
) => Promise<void>;

/**
 * Open the SQLite databases through the same connection settings every writer
 * uses and bind a cascade deleter to them. Async because opening a SQLite handle
 * loads the native binding lazily.
 */
export const createSqliteCascadeDeleter = async (
	paths: SqliteDatabasePaths,
): Promise<CascadeDeleter> => {
	const databases = await openSqliteDatabases(paths);
	const stores = syncStores(databases, BETTER_SQLITE3_LIMITS);
	return (entities, log) => runDrizzleCascadeDelete(stores, entities, log);
};
