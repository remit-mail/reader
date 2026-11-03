import {
	and,
	count,
	eq,
	getTableColumns,
	getTableName,
	inArray,
	is,
	sql,
} from "drizzle-orm";
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
 * Every app table is copied whole. The source has the schema of the release
 * that wrote it, so a table or column added since is not in it: such a table
 * has nothing to copy, and such a column takes the default the migrations give
 * it.
 *
 * Of the mail tables only the rows the IMAP server cannot give back are
 * copied: what the user wrote or decided locally, and the mailbox rows those
 * refer to by id. Everything else resyncs from the
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

// The MCP authorization server's tables (registered clients, consents and
// tokens) join the app database too.
const APP_TABLES: readonly SQLiteTable[] = [
	...tablesOf(appTables),
	...tablesOf(authTables),
	...tablesOf(mcpTables),
];

const keep = (row: Row): Row => row;

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

const columnNamesOf = (db: AnyDb, table: SQLiteTable): string[] =>
	db
		.all<{ name: string }>(
			sql`SELECT name FROM pragma_table_info(${getTableName(table)})`,
		)
		.map((column) => column.name);

const copyTable = async (
	source: AnyDb,
	target: AnyDb,
	table: SQLiteTable,
	transform: (row: Row) => Row,
): Promise<number> => {
	const sourceColumns = new Set(columnNamesOf(source, table));
	const shared = Object.fromEntries(
		Object.entries(getTableColumns(table)).filter(([, column]) =>
			sourceColumns.has(column.name),
		),
	);
	const rows = (await source.select(shared).from(table)).map(transform);
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

/**
 * Fail while the old stack still holds flag changes, moves or deletes it has
 * not pushed to the mail server. The split leaves the mail they refer to to
 * resync, and that resync takes the server state, so splitting now would lose
 * them.
 */
export const assertNothingPending = async (source: AnyDb): Promise<void> => {
	const [{ n: flagChanges }] = await source
		.select({ n: count() })
		.from(mailTables.messageFlagPushes);
	const [{ n: moves }] = await source
		.select({ n: count() })
		.from(mailTables.messagePlacementMoves);
	const [{ n: inFlight }] = await source
		.select({ n: count() })
		.from(mailTables.messageRecords)
		.where(inArray(mailTables.messageRecords.status, ["moving", "deleting"]));
	if (flagChanges + moves + inFlight === 0) return;
	throw new Error(
		`remit.db holds changes not yet pushed to the mail server: ${flagChanges} flag changes, ${moves} moves and ${inFlight} messages moving or deleting. Nothing was split or changed; the update is safe to rerun once the running stack has pushed them.`,
	);
};

/** Whether an app database already holds a row in any app table. */
export const holdsAppRows = async (db: AnyDb): Promise<boolean> => {
	for (const table of APP_TABLES) {
		if (!(await hasTable(db, table))) continue;
		if ((await db.select().from(table).limit(1)).length > 0) return true;
	}
	return false;
};

/** Copy from the old single database into migrated app and mail databases. */
export const splitSqlite = async (
	source: AnyDb,
	targets: { app: AnyDb; mail: AnyDb },
): Promise<SplitSqliteReport> => {
	const copied: SplitSqliteReport = {};
	const copies: ReadonlyArray<
		readonly [SQLiteTable, AnyDb, (row: Row) => Row]
	> = [
		...APP_TABLES.map((table) => [table, targets.app, keep] as const),
		...[...MAILBOX_TABLES, ...LOCAL_MAIL_TABLES].map(
			([table, transform]) => [table, targets.mail, transform] as const,
		),
	];
	// A module lists its tables by name, not by reference, so a row can be
	// copied before the row it refers to (auth_account before auth_user). The
	// references are checked once every table is whole instead.
	for (const target of [targets.app, targets.mail]) {
		target.run(sql`PRAGMA foreign_keys = OFF`);
	}
	for (const [table, target, transform] of copies) {
		if (!(await hasTable(source, table))) continue;
		copied[getTableName(table)] = await copyTable(
			source,
			target,
			table,
			transform,
		);
	}
	for (const [name, target] of Object.entries(targets)) {
		const orphans = target.all<{ table: string }>(
			sql`PRAGMA foreign_key_check`,
		);
		if (orphans.length > 0) {
			throw new Error(
				`the ${name} database refers to rows it does not hold, in ${[...new Set(orphans.map((orphan) => orphan.table))].join(", ")}`,
			);
		}
		target.run(sql`PRAGMA foreign_keys = ON`);
	}
	return copied;
};
