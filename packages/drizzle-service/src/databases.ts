import { syncBatch, type WriteBatch } from "./batch.js";
import type { Db, RepositoryDb } from "./db.js";
import {
	type MessageDataSchema,
	messageDataSchema,
} from "./schema/message-data.js";
import { createSqliteDatabase } from "./sqlite-client.js";

// The three databases a self-host instance runs on (#1420). The app database
// holds what lives in the client: accounts, config, rules, settings and auth.
// The tenant mail database holds what lives on the IMAP server, plus the local
// rows that refer to it. The tenant search database holds the full-text index,
// rebuilt from the mail database, so it never commits together with it.
export interface SqliteDatabases {
	app: Db<Record<string, unknown>>;
	mail: Db<MessageDataSchema>;
	search: Db<Record<string, unknown>>;
}

/** One database a repository runs on, with the write port bound to it. */
export interface SqliteStore<TSchema extends Record<string, unknown>> {
	db: RepositoryDb<TSchema>;
	batch: WriteBatch;
}

/**
 * The same three databases on any SQLite driver: each carries its own write
 * port, so the app database can sit on D1 while mail runs in a Durable Object.
 */
export interface SqliteStores {
	app: SqliteStore<Record<string, unknown>>;
	mail: SqliteStore<MessageDataSchema>;
	search: SqliteStore<Record<string, unknown>>;
}

export const syncStore = <TSchema extends Record<string, unknown>>(
	db: Db<TSchema>,
): SqliteStore<TSchema> => ({ db, batch: syncBatch(db) });

export const syncStores = ({
	app,
	mail,
	search,
}: SqliteDatabases): SqliteStores => ({
	app: syncStore(app),
	mail: syncStore(mail),
	search: syncStore(search),
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
