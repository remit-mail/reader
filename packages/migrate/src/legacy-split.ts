import {
	closeSync,
	existsSync,
	fsyncSync,
	openSync,
	renameSync,
	rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import type { drizzle as drizzleBetterSqlite3 } from "drizzle-orm/better-sqlite3";
import type { SqliteDatabasePaths } from "../../drizzle-service/src/databases.js";
import { applyMigrationSets } from "./migration-sets.js";
import {
	holdsAppRows,
	type SplitSqliteReport,
	splitSqlite,
} from "./split-sqlite.js";

/**
 * The one-time move from the single database file a pre-#1420 install ran on,
 * done by the migrate one-shot on the first start of a release that has three.
 *
 * The three databases are built under staging names and moved into place only
 * once the copy is whole, app.db last: an app.db holding data is what says the
 * split happened, so a split that dies before that rename is done again on the
 * next start. The source is renamed after it: `remit.db.pre-split` is both the
 * record that the split ran and the original, kept on disk.
 */

// The native driver is handed in rather than imported, so this module bundles
// with better-sqlite3 marked external (see npm-scripts/docker-bundle.mjs).
export interface SqliteDriver {
	Database: typeof BetterSqlite3;
	drizzle: typeof drizzleBetterSqlite3;
}

export type LegacySplitOutcome =
	| { kind: "absent" }
	| { kind: "superseded" }
	| { kind: "split"; copied: SplitSqliteReport; dropped: SplitSqliteReport };

const DATABASES = ["app", "mail", "search"] as const;

type Staged = Record<(typeof DATABASES)[number], string>;

type SplitReport = { copied: SplitSqliteReport; dropped: SplitSqliteReport };

export const PRE_SPLIT_SUFFIX = ".pre-split";

/** Where the pre-#1420 compose file kept its one database: beside app.db. */
export const legacyDatabasePath = (paths: SqliteDatabasePaths): string =>
	join(dirname(paths.app), "remit.db");

const removeDatabase = (path: string): void => {
	for (const file of [path, `${path}-wal`, `${path}-shm`]) {
		rmSync(file, { force: true });
	}
};

const moveIntoPlace = (from: string, to: string): void => {
	removeDatabase(to);
	renameSync(from, to);
	const directory = openSync(dirname(to), "r");
	try {
		fsyncSync(directory);
	} finally {
		closeSync(directory);
	}
};

const copyIntoStaged = async (
	from: BetterSqlite3.Database,
	staged: Staged,
	driver: SqliteDriver,
	migrationsRoot: string,
	log: (database: string) => void,
): Promise<SplitReport> => {
	const handles = {
		app: new driver.Database(staged.app),
		mail: new driver.Database(staged.mail),
		search: new driver.Database(staged.search),
	};
	try {
		const app = driver.drizzle(handles.app);
		const mail = driver.drizzle(handles.mail);
		await applyMigrationSets(
			{ app, mail, search: driver.drizzle(handles.search) },
			migrationsRoot,
			log,
		);
		return await splitSqlite(driver.drizzle(from), { app, mail });
	} finally {
		for (const database of DATABASES) handles[database].close();
	}
};

const appDatabaseHoldsRows = async (
	path: string,
	driver: SqliteDriver,
): Promise<boolean> => {
	if (!existsSync(path)) return false;
	const sqlite = new driver.Database(path, { readonly: true });
	try {
		return await holdsAppRows(driver.drizzle(sqlite));
	} finally {
		sqlite.close();
	}
};

export const splitLegacyDatabase = async (
	source: string,
	paths: SqliteDatabasePaths,
	driver: SqliteDriver,
	migrationsRoot: string,
	log: (database: string) => void,
): Promise<LegacySplitOutcome> => {
	if (!existsSync(source)) return { kind: "absent" };
	if (await appDatabaseHoldsRows(paths.app, driver)) {
		return { kind: "superseded" };
	}

	const staged: Staged = {
		app: `${paths.app}.splitting`,
		mail: `${paths.mail}.splitting`,
		search: `${paths.search}.splitting`,
	};
	for (const database of DATABASES) removeDatabase(staged[database]);

	// Opened writable so closing it folds a write-ahead log the old stack left
	// into the file itself; a rename would otherwise leave that log behind. The
	// exclusive lock is held for the whole copy and taken without waiting, so an
	// old backend still writing to the file fails the split instead of writing
	// to a file about to be renamed aside.
	const from = new driver.Database(source, { fileMustExist: true });
	let report: SplitReport;
	try {
		from.pragma("busy_timeout = 0");
		from.exec("BEGIN EXCLUSIVE");
		report = await copyIntoStaged(from, staged, driver, migrationsRoot, log);
		from.exec("COMMIT");
	} finally {
		from.close();
	}

	moveIntoPlace(staged.mail, paths.mail);
	moveIntoPlace(staged.search, paths.search);
	moveIntoPlace(staged.app, paths.app);
	moveIntoPlace(source, `${source}${PRE_SPLIT_SUFFIX}`);
	return { kind: "split", ...report };
};
