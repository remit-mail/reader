import { and, count, eq, getTableColumns, getTableName, is } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { SQLiteTable, sqliteTable, text } from "drizzle-orm/sqlite-core";
import * as authTables from "../../auth-service/src/schema/auth-schema-sqlite.js";
import { syncBatch } from "../../drizzle-service/src/batch.js";
import * as appTables from "../../drizzle-service/src/schema-sets/app.js";
import * as mailTables from "../../drizzle-service/src/schema-sets/mail.js";
import * as mcpTables from "../../mcp-server/src/auth/schema.js";

/**
 * The one-time move from the single self-host database file to the app, tenant
 * mail and tenant search databases (#1420), run by the migrate one-shot.
 *
 * Every app table is copied whole. Of the mail tables only the rows the IMAP
 * server cannot give back are copied: what the user wrote or decided locally,
 * and the mailbox rows those refer to by id. Everything else resyncs from the
 * server, and the search index fills as it does.
 *
 * The inserts are plain: a target that already holds a row fails the split
 * rather than having it merged, because a stack that wrote before the split
 * ran is a state to look at, not one to paper over.
 */

type AnyDb = BetterSQLite3Database<Record<string, unknown>>;

type Row = Record<string, unknown>;

const tablesOf = (module: Record<string, unknown>): SQLiteTable[] =>
	Object.values(module).filter((value): value is SQLiteTable =>
		is(value, SQLiteTable),
	);

const APP_TABLES: readonly SQLiteTable[] = [
	...tablesOf(appTables),
	...tablesOf(authTables),
];

const keep = (row: Row): Row => row;

// The MCP authorization server's tables: registered clients, consents and
// tokens. They join the app database, but a source written before the MCP
// connector shipped has none of them, so each is copied only where it exists.
const MCP_TABLES: readonly SQLiteTable[] = tablesOf(mcpTables);

const sqliteMaster = sqliteTable("sqlite_master", {
	type: text("type").notNull(),
	name: text("name").notNull(),
});

const hasTable = async (source: AnyDb, table: SQLiteTable): Promise<boolean> =>
	(
		await source
			.select({ name: sqliteMaster.name })
			.from(sqliteMaster)
			.where(
				and(
					eq(sqliteMaster.type, "table"),
					eq(sqliteMaster.name, getTableName(table)),
				),
			)
	).length > 0;

// Local state, with no IMAP source: the outbox, quarantined mail, labels on
// messages, calendar suggestions, organize jobs, the user's flags on addresses
// (muting) and the signer standings they affirmed. The message ids they carry
// are derived from the account and the Message-ID header, so they still name
// the same messages once those resync. The counters on addresses and standings
// are counted again by that resync, so they start from zero.
const LOCAL_MAIL_TABLES: ReadonlyArray<[SQLiteTable, (row: Row) => Row]> = [
	[mailTables.outboxMessages, keep],
	[mailTables.outboxAttachments, keep],
	[mailTables.quarantines, keep],
	[mailTables.messageLabels, keep],
	[mailTables.calendarSuggestions, keep],
	[mailTables.organizeJobRequests, keep],
	[mailTables.addresses, (row) => ({ ...row, inboundCount: 0 })],
	[mailTables.senderSignerStandings, (row) => ({ ...row, messageCount: 0 })],
];

// The state a folder has when the server first reports it: no message applied,
// so message sync starts over and fetches it whole. Mailbox ids are generated,
// not derived, and filters, folder-role appointments and quarantined mail refer
// to them, so the rows are kept; their children describe the folder rather
// than its messages.
const resetSyncCursor = (row: Row): Row => ({
	...row,
	highestModseq: "0",
	totalSize: 0,
	lastSyncUid: 0,
	highWaterMarkUid: 0,
	lastMessageSyncAt: 0,
	initialSyncCompletedAt: null,
	cursorState: "normal",
});

const MAILBOX_TABLES: ReadonlyArray<[SQLiteTable, (row: Row) => Row]> = [
	[mailTables.mailboxes, resetSyncCursor],
	[mailTables.mailboxSpecialUseEntries, keep],
	[mailTables.mailboxAttributeEntries, keep],
	[mailTables.mailboxFlags, keep],
];

// D1 refuses a statement with more than 100 bound parameters.
const PARAMETER_BUDGET = 90;

const copyTable = async (
	source: AnyDb,
	target: AnyDb,
	table: SQLiteTable,
	transform: (row: Row) => Row,
): Promise<number> => {
	const rows = (await source.select().from(table)).map(transform);
	const columns = Object.keys(getTableColumns(table)).length;
	const perStatement = Math.max(1, Math.floor(PARAMETER_BUDGET / columns));
	const statements = [];
	for (let start = 0; start < rows.length; start += perStatement) {
		statements.push(
			target.insert(table).values(rows.slice(start, start + perStatement)),
		);
	}
	await syncBatch(target)(statements);
	return rows.length;
};

export type SplitSqliteReport = Record<string, number>;

// Flag changes and moves the old stack queued but has not yet pushed to the
// server. They are not copied: their ids point at mail the split leaves to
// resync, and that resync takes the server state as it finds it. The counts
// are reported so the loss is stated rather than silent.
const PENDING_PUSH_TABLES: readonly SQLiteTable[] = [
	mailTables.messageFlagPushes,
	mailTables.messagePlacementMoves,
];

/** Whether an app database already holds a row in any app table. */
export const holdsAppRows = async (db: AnyDb): Promise<boolean> => {
	for (const table of [...APP_TABLES, ...MCP_TABLES]) {
		if (!(await hasTable(db, table))) continue;
		if ((await db.select().from(table).limit(1)).length > 0) return true;
	}
	return false;
};

/** Copy from the old single database into migrated app and mail databases. */
export const splitSqlite = async (
	source: AnyDb,
	targets: { app: AnyDb; mail: AnyDb },
): Promise<{ copied: SplitSqliteReport; dropped: SplitSqliteReport }> => {
	const copied: SplitSqliteReport = {};
	for (const table of APP_TABLES) {
		copied[getTableName(table)] = await copyTable(
			source,
			targets.app,
			table,
			keep,
		);
	}
	for (const table of MCP_TABLES) {
		if (!(await hasTable(source, table))) continue;
		copied[getTableName(table)] = await copyTable(
			source,
			targets.app,
			table,
			keep,
		);
	}
	for (const [table, transform] of [...MAILBOX_TABLES, ...LOCAL_MAIL_TABLES]) {
		copied[getTableName(table)] = await copyTable(
			source,
			targets.mail,
			table,
			transform,
		);
	}
	const dropped: SplitSqliteReport = {};
	for (const table of PENDING_PUSH_TABLES) {
		const [{ n }] = await source.select({ n: count() }).from(table);
		if (n > 0) dropped[getTableName(table)] = n;
	}
	return { copied, dropped };
};
