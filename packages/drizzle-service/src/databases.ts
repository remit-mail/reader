import { syncBatch } from "./batch.js";
import type { SqliteLimits } from "./bound-parameters.js";
import type { Db, SqliteStore } from "./db.js";
import { messageDataSchema } from "./schema/message-data.js";
import { createSqliteDatabase } from "./sqlite-client.js";

// The three databases a self-host instance runs on (#1420). The app database
// holds what lives in the client: accounts, config, rules, settings and auth.
// The tenant mail database holds what lives on the IMAP server, plus the local
// rows that refer to it. The tenant search database holds the full-text index,
// rebuilt from the mail database, so it never commits together with it.
export interface SqliteDatabases {
	app: Db<Record<string, unknown>>;
	mail: Db<Record<string, unknown>>;
	search: Db<Record<string, unknown>>;
}

export interface SqliteStores {
	app: SqliteStore<Record<string, unknown>>;
	mail: SqliteStore<Record<string, unknown>>;
	search: SqliteStore<Record<string, unknown>>;
}

export const syncStore = <TSchema extends Record<string, unknown>>(
	db: Db<TSchema>,
	{ maxBoundParameters }: SqliteLimits,
): SqliteStore<TSchema> => ({ db, batch: syncBatch(db), maxBoundParameters });

export const syncStores = (
	{ app, mail, search }: SqliteDatabases,
	limits: SqliteLimits,
): SqliteStores => ({
	app: syncStore(app, limits),
	mail: syncStore(mail, limits),
	search: syncStore(search, limits),
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
	const app = await createSqliteDatabase({}, { filename: paths.app });
	const mail = await createSqliteDatabase(messageDataSchema, {
		filename: paths.mail,
	});
	const search = await createSqliteDatabase({}, { filename: paths.search });
	return {
		app: app.db,
		mail: mail.db,
		search: search.db,
		close: async () => {
			await Promise.all([app.close(), mail.close(), search.close()]);
		},
	};
};
