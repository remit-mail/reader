import Database from "better-sqlite3";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import {
	type BetterSQLite3Database,
	drizzle,
} from "drizzle-orm/better-sqlite3";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import * as authTables from "../../auth-service/src/schema/auth-schema-sqlite.js";
import * as metaTables from "../../auth-service/src/schema/meta-schema-sqlite.js";
import { runBatch } from "../../drizzle-service/src/batch.js";
import type { SqliteDatabasePaths } from "../../drizzle-service/src/databases.js";
import * as appTables from "../../drizzle-service/src/schema-sets/app.js";
import * as mailTables from "../../drizzle-service/src/schema-sets/mail.js";
import { applyMigrationSets } from "./migration-sets.js";

/**
 * The one-time move from the single self-host database file to the app, tenant
 * mail and tenant search databases (#1420).
 *
 * Every app table is copied whole. Of the mail tables only the rows the IMAP
 * server cannot give back are copied: what the user wrote or decided locally,
 * and the mailbox rows those refer to by id. Everything else resyncs from the
 * server, and the search index fills as it does.
 */

type AnyDb = BetterSQLite3Database<Record<string, unknown>>;

const tablesOf = (module: Record<string, unknown>): SQLiteTable[] =>
	Object.values(module).filter((value): value is SQLiteTable =>
		is(value, SQLiteTable),
	);

const APP_TABLES: readonly SQLiteTable[] = [
	...tablesOf(appTables),
	...tablesOf(authTables),
	...tablesOf(metaTables),
];

// Local state, with no IMAP source: the outbox, quarantined mail, labels on
// messages, calendar suggestions, organize jobs, sender standings, the user's
// flags on addresses (muting), and flag changes and moves not yet pushed. The
// message ids they carry are derived from the account and the Message-ID
// header, so they still name the same messages once those resync.
const LOCAL_MAIL_TABLES: readonly SQLiteTable[] = [
	mailTables.outboxMessages,
	mailTables.outboxAttachments,
	mailTables.quarantines,
	mailTables.messageLabels,
	mailTables.calendarSuggestions,
	mailTables.organizeJobRequests,
	mailTables.senderSignerStandings,
	mailTables.addresses,
	mailTables.messageFlagPushes,
	mailTables.messagePlacementMoves,
];

// Mailbox ids are generated, not derived, and filters, folder-role appointments
// and quarantined mail refer to them. The rows are kept so those references
// survive; their children describe the folder rather than its messages.
const MAILBOX_CHILD_TABLES: readonly SQLiteTable[] = [
	mailTables.mailboxSpecialUseEntries,
	mailTables.mailboxAttributeEntries,
	mailTables.mailboxFlags,
];

// D1 refuses a statement with more than 100 bound parameters.
const PARAMETER_BUDGET = 90;

type Row = Record<string, unknown>;

const copyRows = async (
	target: AnyDb,
	table: SQLiteTable,
	rows: readonly Row[],
): Promise<number> => {
	const columns = Object.keys(getTableColumns(table)).length;
	const perStatement = Math.max(1, Math.floor(PARAMETER_BUDGET / columns));
	const statements = [];
	for (let start = 0; start < rows.length; start += perStatement) {
		statements.push(
			target
				.insert(table)
				.values(rows.slice(start, start + perStatement))
				.onConflictDoNothing(),
		);
	}
	await runBatch(target, statements);
	return rows.length;
};

const copyTable = async (
	source: AnyDb,
	target: AnyDb,
	table: SQLiteTable,
): Promise<number> =>
	copyRows(target, table, await source.select().from(table));

// The state a folder has when the server first reports it: no message applied,
// so message sync starts over and fetches it whole.
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

export interface SplitSqliteOptions {
	source: string;
	targets: SqliteDatabasePaths;
	/** Where the committed migration sets are staged. */
	migrationsRoot: string;
}

export type SplitSqliteReport = Record<string, number>;

export const splitSqlite = async ({
	source,
	targets,
	migrationsRoot,
}: SplitSqliteOptions): Promise<SplitSqliteReport> => {
	const targetPaths = Object.values(targets);
	if (targetPaths.includes(source)) {
		throw new Error(`the source ${source} cannot also be a target`);
	}
	if (new Set(targetPaths).size !== targetPaths.length) {
		throw new Error("the app, mail and search targets must be three files");
	}

	const sourceSqlite = new Database(source, {
		readonly: true,
		fileMustExist: true,
	});
	const open = (path: string): Database.Database => {
		const sqlite = new Database(path);
		sqlite.pragma("journal_mode = WAL");
		sqlite.pragma("busy_timeout = 5000");
		return sqlite;
	};
	const appSqlite = open(targets.app);
	const mailSqlite = open(targets.mail);
	const searchSqlite = open(targets.search);
	try {
		const from: AnyDb = drizzle(sourceSqlite);
		const app: AnyDb = drizzle(appSqlite);
		const mail: AnyDb = drizzle(mailSqlite);
		await applyMigrationSets(
			{ app, mail, search: drizzle(searchSqlite) },
			migrationsRoot,
			() => {},
		);

		const report: SplitSqliteReport = {};
		for (const table of APP_TABLES) {
			report[getTableName(table)] = await copyTable(from, app, table);
		}
		const mailboxes = await from.select().from(mailTables.mailboxes);
		report.mailbox = await copyRows(
			mail,
			mailTables.mailboxes,
			mailboxes.map(resetSyncCursor),
		);
		for (const table of [...MAILBOX_CHILD_TABLES, ...LOCAL_MAIL_TABLES]) {
			report[getTableName(table)] = await copyTable(from, mail, table);
		}
		return report;
	} finally {
		sourceSqlite.close();
		appSqlite.close();
		mailSqlite.close();
		searchSqlite.close();
	}
};
