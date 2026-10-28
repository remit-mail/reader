import { eq } from "drizzle-orm";
import {
	getTableConfig,
	type SQLiteColumn,
	SQLiteTable,
} from "drizzle-orm/sqlite-core";
import type { SqliteBatchItem } from "../batch.js";
import { chunk } from "../bound-parameters.js";
import type { SqliteStores } from "../databases.js";
import type { SqliteStore } from "../db.js";
import {
	accountConfigTable,
	accountTable,
} from "../schema/i4-account-config.js";
import { mailboxTable } from "../schema/i4-mailbox.js";
import { calendarTable, messageTable } from "../schema.js";
import * as appTables from "../schema-sets/app.js";
import * as mailTables from "../schema-sets/mail.js";
import { SearchIndex } from "../search/thread-message-search.js";
import type { CascadeDeleteLogger } from "./cascade-delete.js";
import { inList } from "./in-list.js";

/**
 * The column an account config owns a table's rows by: its own id where the
 * table carries it, else the first id of the parent it hangs off.
 */
export const OWNER_KEYS = [
	"account_config_id",
	"account_id",
	"mailbox_id",
	"message_id",
	"calendar_id",
] as const;

export type OwnerKey = (typeof OWNER_KEYS)[number];

export interface OwnedTable {
	readonly table: SQLiteTable;
	readonly ownerKey: OwnerKey;
	readonly ownerColumn: SQLiteColumn;
}

export const ownedTablesOf = (tables: Record<string, unknown>): OwnedTable[] =>
	Object.values(tables).flatMap((table) => {
		if (!(table instanceof SQLiteTable)) return [];
		const { columns } = getTableConfig(table);
		for (const ownerKey of OWNER_KEYS) {
			const ownerColumn = columns.find((column) => column.name === ownerKey);
			if (ownerColumn !== undefined) return [{ table, ownerKey, ownerColumn }];
		}
		return [];
	});

// Durable Object SQLite caps a bound value at 2 MB; a chunk of ids stays far
// below it.
const IDS_PER_STATEMENT = 5_000;

type OwnerIds = Readonly<Record<OwnerKey, readonly string[]>>;

const keyedDeletes = (
	store: SqliteStore<Record<string, unknown>>,
	tables: readonly OwnedTable[],
	ids: OwnerIds,
): SqliteBatchItem[] =>
	tables
		.filter(({ table }) => table !== accountConfigTable)
		.flatMap(({ table, ownerKey, ownerColumn }) =>
			ownerKey === "account_config_id"
				? ids.account_config_id.map((id) =>
						store.db.delete(table).where(eq(ownerColumn, id)),
					)
				: chunk(ids[ownerKey], IDS_PER_STATEMENT).map((slice) =>
						store.db.delete(table).where(inList(ownerColumn, slice)),
					),
		);

const APP_TABLES = ownedTablesOf(appTables);
const MAIL_TABLES = ownedTablesOf(mailTables);

const idsOf = async <Row>(
	rows: PromiseLike<Row[]>,
	pick: (row: Row) => string,
): Promise<string[]> => (await rows).map(pick);

/**
 * Delete the app database rows an account config owns, except the
 * AccountConfig row itself, which the caller deletes last.
 */
export const eraseAccountConfigAppRows = async (
	app: SqliteStore<Record<string, unknown>>,
	accountConfigId: string,
	accountIds: readonly string[],
): Promise<void> => {
	const calendarIds = await idsOf(
		app.db
			.select({ calendarId: calendarTable.calendarId })
			.from(calendarTable)
			.where(eq(calendarTable.accountConfigId, accountConfigId)),
		(row) => row.calendarId,
	);
	await app.batch(
		keyedDeletes(app, APP_TABLES, {
			account_config_id: [accountConfigId],
			account_id: accountIds,
			mailbox_id: [],
			message_id: [],
			calendar_id: calendarIds,
		}),
	);
};

export const accountIdsOf = (
	app: SqliteStore<Record<string, unknown>>,
	accountConfigId: string,
): Promise<string[]> =>
	idsOf(
		app.db
			.select({ accountId: accountTable.accountId })
			.from(accountTable)
			.where(eq(accountTable.accountConfigId, accountConfigId)),
		(row) => row.accountId,
	);

/**
 * Delete every row an account config owns across the app, mail and search
 * databases, one keyed statement per table. A rerun deletes what is left.
 */
export const runDrizzleAccountConfigErase = async (
	stores: SqliteStores,
	accountConfigId: string,
	log: CascadeDeleteLogger,
): Promise<void> => {
	const { app, mail, search } = stores;
	const accountIds = await accountIdsOf(app, accountConfigId);
	const mailboxIds = await idsOf(
		mail.db
			.select({ mailboxId: mailboxTable.mailboxId })
			.from(mailboxTable)
			.where(inList(mailboxTable.accountId, accountIds)),
		(row) => row.mailboxId,
	);
	const messageIds = await idsOf(
		mail.db
			.select({ messageId: messageTable.messageId })
			.from(messageTable)
			.where(inList(messageTable.mailboxId, mailboxIds)),
		(row) => row.messageId,
	);

	await new SearchIndex(mail.db, search).removeAccount(accountConfigId);
	await mail.batch(
		keyedDeletes(mail, MAIL_TABLES, {
			account_config_id: [accountConfigId],
			account_id: accountIds,
			mailbox_id: mailboxIds,
			message_id: messageIds,
			calendar_id: [],
		}),
	);
	await eraseAccountConfigAppRows(app, accountConfigId, accountIds);

	log.info(
		{
			accountConfigId,
			accountCount: accountIds.length,
			messageCount: messageIds.length,
		},
		"Drizzle account config erase complete",
	);
};
