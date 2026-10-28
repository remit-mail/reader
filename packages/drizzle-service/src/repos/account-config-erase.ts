import { eq } from "drizzle-orm";
import {
	getTableConfig,
	type SQLiteColumn,
	SQLiteTable,
} from "drizzle-orm/sqlite-core";
import type { SqliteBatchItem } from "../batch.js";
import { BETTER_SQLITE3_LIMITS, chunk } from "../bound-parameters.js";
import {
	openSqliteDatabases,
	type SqliteDatabasePaths,
	type SqliteStores,
	syncStores,
} from "../databases.js";
import {
	accountConfigTable,
	accountTable,
} from "../schema/i4-account-config.js";
import {
	mailboxAttributeTable,
	mailboxFlagTable,
	mailboxSpecialUseTable,
	mailboxTable,
} from "../schema/i4-mailbox.js";
import { mailboxLockTable } from "../schema/i4-mailbox-lock.js";
import { threadMessageTable } from "../schema/thread-message.js";
import {
	calendarEventIndexTable,
	calendarObjectTable,
	calendarTable,
	messageTable,
} from "../schema.js";
import * as appTables from "../schema-sets/app.js";
import * as mailTables from "../schema-sets/mail.js";
import { SearchIndex } from "../search/thread-message-search.js";
import type { CascadeDeleteLogger } from "./cascade-delete.js";
import { inList } from "./in-list.js";
import { deleteMessageSubtree } from "./message.js";

const ACCOUNT_CONFIG_COLUMN = "account_config_id";

// Durable Object SQLite caps a bound value at 2 MB; a chunk of message ids
// stays far below it.
const MESSAGE_IDS_PER_STATEMENT = 5_000;

export interface TenantTable {
	readonly table: SQLiteTable;
	readonly accountConfigColumn: SQLiteColumn;
}

const tenantTablesOf = (
	tables: Record<string, unknown>,
	except: readonly SQLiteTable[],
): TenantTable[] =>
	Object.values(tables).flatMap((table) => {
		if (!(table instanceof SQLiteTable) || except.includes(table)) return [];
		const accountConfigColumn = getTableConfig(table).columns.find(
			(column) => column.name === ACCOUNT_CONFIG_COLUMN,
		);
		return accountConfigColumn === undefined
			? []
			: [{ table, accountConfigColumn }];
	});

/**
 * Every app table keyed by account config id, except the account config row
 * itself, which the caller deletes last as the erase-in-progress marker.
 */
export const APP_TENANT_TABLES: readonly TenantTable[] = tenantTablesOf(
	appTables,
	[accountConfigTable],
);

export const MAIL_TENANT_TABLES: readonly TenantTable[] = tenantTablesOf(
	mailTables,
	[],
);

/**
 * Delete every row an account config owns, across the app, mail and search
 * databases, by key rather than by enumerating rows: one statement per table
 * keyed by account config id, plus the tables reached only through an
 * account, mailbox, message or calendar id. A rerun deletes what is left.
 */
export const runDrizzleAccountConfigErase = async (
	stores: SqliteStores,
	accountConfigId: string,
	log: CascadeDeleteLogger,
): Promise<void> => {
	const app = stores.app.db;
	const mail = stores.mail.db;

	const accountIds = (
		await app
			.select({ accountId: accountTable.accountId })
			.from(accountTable)
			.where(eq(accountTable.accountConfigId, accountConfigId))
	).map((row) => row.accountId);
	const mailboxIds = (
		await mail
			.select({ mailboxId: mailboxTable.mailboxId })
			.from(mailboxTable)
			.where(inList(mailboxTable.accountId, accountIds))
	).map((row) => row.mailboxId);
	const messageIds = (
		await mail
			.select({ messageId: messageTable.messageId })
			.from(messageTable)
			.where(inList(messageTable.mailboxId, mailboxIds))
	).map((row) => row.messageId);
	const threadMessageIds = (
		await mail
			.select({ threadMessageId: threadMessageTable.threadMessageId })
			.from(threadMessageTable)
			.where(eq(threadMessageTable.accountConfigId, accountConfigId))
	).map((row) => row.threadMessageId);
	const calendarIds = (
		await app
			.select({ calendarId: calendarTable.calendarId })
			.from(calendarTable)
			.where(eq(calendarTable.accountConfigId, accountConfigId))
	).map((row) => row.calendarId);

	const mailItems: SqliteBatchItem[] = [
		...chunk(messageIds, MESSAGE_IDS_PER_STATEMENT).flatMap((ids) =>
			deleteMessageSubtree(mail, ids),
		),
		...[mailboxAttributeTable, mailboxFlagTable, mailboxSpecialUseTable].map(
			(table) => mail.delete(table).where(inList(table.mailboxId, mailboxIds)),
		),
		mail
			.delete(mailboxLockTable)
			.where(inList(mailboxLockTable.accountId, accountIds)),
		mail.delete(mailboxTable).where(inList(mailboxTable.accountId, accountIds)),
		...MAIL_TENANT_TABLES.map(({ table, accountConfigColumn }) =>
			mail.delete(table).where(eq(accountConfigColumn, accountConfigId)),
		),
	];
	const appItems: SqliteBatchItem[] = [
		app
			.delete(calendarEventIndexTable)
			.where(inList(calendarEventIndexTable.calendarId, calendarIds)),
		app
			.delete(calendarObjectTable)
			.where(inList(calendarObjectTable.calendarId, calendarIds)),
		...APP_TENANT_TABLES.map(({ table, accountConfigColumn }) =>
			app.delete(table).where(eq(accountConfigColumn, accountConfigId)),
		),
	];

	await stores.mail.batch(mailItems);
	await stores.app.batch(appItems);
	await new SearchIndex(mail, stores.search).sync(threadMessageIds);

	log.info(
		{
			accountConfigId,
			accountCount: accountIds.length,
			messageCount: messageIds.length,
		},
		"Drizzle account config erase complete",
	);
};

export type AccountConfigEraser = (
	accountConfigId: string,
	log: CascadeDeleteLogger,
) => Promise<void>;

export const createSqliteAccountConfigEraser = async (
	paths: SqliteDatabasePaths,
): Promise<AccountConfigEraser> => {
	const databases = await openSqliteDatabases(paths);
	const stores = syncStores(databases, BETTER_SQLITE3_LIMITS);
	return (accountConfigId, log) =>
		runDrizzleAccountConfigErase(stores, accountConfigId, log);
};
