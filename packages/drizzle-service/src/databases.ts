import { syncBatch, type TransactionRunner } from "./batch.js";
import type { SqliteLimits } from "./bound-parameters.js";
import type { Db, SqliteStore } from "./db.js";

// The three databases an instance runs on (#1420), each on the file its
// SQLITE_*_DB_PATH names; a self-host points all three at one remit.db. The app
// database holds what lives in the client: accounts, config, rules, settings
// and auth. The tenant mail database holds what lives on the IMAP server, plus
// the local rows that refer to it. The tenant search database holds the
// full-text index, rebuilt from the mail database, so it never commits together
// with it.
export interface SqliteDatabases {
	app: Db;
	mail: Db;
	search: Db;
	transactions: SqliteTransactions;
}

export interface SqliteTransactions {
	app: TransactionRunner;
	mail: TransactionRunner;
	search: TransactionRunner;
}

export interface SqliteStores {
	app: SqliteStore<Record<string, unknown>>;
	mail: SqliteStore<Record<string, unknown>>;
	search: SqliteStore<Record<string, unknown>>;
}

export const syncStore = (
	db: Db,
	{ maxBoundParameters }: SqliteLimits,
	run: TransactionRunner,
): SqliteStore<Record<string, unknown>> => ({
	db,
	batch: syncBatch(run),
	maxBoundParameters,
});

export const syncStores = (
	{ app, mail, search, transactions }: SqliteDatabases,
	limits: SqliteLimits,
): SqliteStores => ({
	app: syncStore(app, limits, transactions.app),
	mail: syncStore(mail, limits, transactions.mail),
	search: syncStore(search, limits, transactions.search),
});

export interface SqliteDatabasePaths {
	app: string;
	mail: string;
	search: string;
}

export const SQLITE_DATABASE_ENV = {
	app: "SQLITE_APP_DB_PATH",
	mail: "SQLITE_MAIL_DB_PATH",
	search: "SQLITE_SEARCH_DB_PATH",
} as const satisfies Record<keyof SqliteDatabasePaths, string>;

/**
 * Whether this process is configured for the SQLite composition. The app path
 * is the precondition every composition root checks before importing it.
 */
export const hasSqliteDatabaseEnv = (
	env: NodeJS.ProcessEnv = process.env,
): boolean => Boolean(env[SQLITE_DATABASE_ENV.app]);

export const sqliteDatabasePathsFromEnv = (
	env: NodeJS.ProcessEnv = process.env,
): SqliteDatabasePaths => {
	const read = (name: string): string => {
		const value = env[name];
		if (!value) throw new Error(`${name} is required`);
		return value;
	};
	return {
		app: read(SQLITE_DATABASE_ENV.app),
		mail: read(SQLITE_DATABASE_ENV.mail),
		search: read(SQLITE_DATABASE_ENV.search),
	};
};

export const openSqliteDatabases = async (
	paths: SqliteDatabasePaths,
): Promise<SqliteDatabases & { close: () => Promise<void> }> => {
	const { openSqlite } = await import("./sqlite.js");
	const open = (filename: string) => openSqlite({ filename, mode: "create" });
	const app = open(paths.app);
	const mail = open(paths.mail);
	const search = open(paths.search);
	return {
		app: app.db,
		mail: mail.db,
		search: search.db,
		transactions: {
			app: app.immediate,
			mail: mail.immediate,
			search: search.immediate,
		},
		close: async () => {
			app.close();
			mail.close();
			search.close();
		},
	};
};
