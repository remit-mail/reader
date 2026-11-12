import Database from "better-sqlite3";
import {
	type BetterSQLite3Database,
	drizzle,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

export type SqliteSynchronous = "OFF" | "NORMAL" | "FULL";

export interface OpenSqliteOptions<TSchema extends Record<string, unknown>> {
	/** A file path, or `:memory:`. */
	filename: string;
	readonly: boolean;
	mustExist: boolean;
	synchronous: SqliteSynchronous;
	schema: TSchema;
}

export type SqliteDb<TSchema extends Record<string, unknown>> =
	BetterSQLite3Database<TSchema> & { $client: Database.Database };

export const MEMORY = ":memory:";

/**
 * Open a SQLite database. A writable file runs in WAL mode; every handle has
 * foreign keys on and waits up to 5 s on a lock held by another connection.
 */
export function openSqlite<TSchema extends Record<string, unknown>>(
	options: OpenSqliteOptions<TSchema>,
): SqliteDb<TSchema> {
	const sqlite = new Database(options.filename, {
		readonly: options.readonly,
		fileMustExist: options.mustExist,
	});
	if (!options.readonly && options.filename !== MEMORY) {
		sqlite.pragma("journal_mode = WAL");
	}
	sqlite.pragma("busy_timeout = 5000");
	sqlite.pragma(`synchronous = ${options.synchronous}`);
	sqlite.pragma("foreign_keys = ON");
	return drizzle(sqlite, { schema: options.schema });
}

/** A writable in-memory database, for a test. */
export function openTestSqlite<TSchema extends Record<string, unknown>>(
	schema: TSchema,
): SqliteDb<TSchema> {
	return openSqlite({
		filename: MEMORY,
		readonly: false,
		mustExist: false,
		synchronous: "OFF",
		schema,
	});
}

/** Apply a drizzle migrations folder to an open database. */
export function migrateSqlite<TSchema extends Record<string, unknown>>(
	db: SqliteDb<TSchema>,
	migrationsFolder: string,
): void {
	migrate(db, { migrationsFolder });
}
