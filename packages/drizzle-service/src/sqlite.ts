import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { MigrationConfig } from "drizzle-orm/migrator";
import type { Db } from "./db.js";

export type { Db } from "./db.js";

export type SqliteMode = "create" | "open" | "readonly";

export type SqliteSynchronous = "OFF" | "NORMAL" | "FULL";

export interface OpenSqliteOptions<TSchema extends Record<string, unknown>> {
	filename: string;
	mode: SqliteMode;
	synchronous: SqliteSynchronous;
	schema: TSchema;
}

export interface SqliteStatement {
	all(...params: unknown[]): unknown[];
	get(...params: unknown[]): unknown;
	run(...params: unknown[]): { changes: number };
}

export interface SqliteConnection {
	prepare(source: string): SqliteStatement;
}

export interface SqliteHandle<TSchema extends Record<string, unknown>> {
	db: Db<TSchema>;
	sqlite: SqliteConnection;
	exec(sql: string): void;
	close(): void;
}

const drivers = new WeakMap<object, Database.Database>();

// A writable database runs in WAL mode, and every handle waits up to 5 s on a
// lock another connection holds.
export function openSqlite<TSchema extends Record<string, unknown>>(
	options: OpenSqliteOptions<TSchema>,
): SqliteHandle<TSchema> {
	const sqlite = new Database(options.filename, {
		readonly: options.mode === "readonly",
		fileMustExist: options.mode !== "create",
	});
	if (options.mode !== "readonly") sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("busy_timeout = 5000");
	sqlite.pragma(`synchronous = ${options.synchronous}`);
	sqlite.pragma("foreign_keys = ON");

	const db = drizzle({ client: sqlite });
	const handle: SqliteHandle<TSchema> = {
		db,
		sqlite,
		exec: (sql) => {
			sqlite.exec(sql);
		},
		close: () => {
			sqlite.close();
		},
	};
	drivers.set(handle, sqlite);
	return handle;
}

export function openTestSqlite<TSchema extends Record<string, unknown>>(
	schema: TSchema,
): SqliteHandle<TSchema> {
	return openSqlite({
		filename: ":memory:",
		mode: "create",
		synchronous: "OFF",
		schema,
	});
}

export function migrateSqlite<TSchema extends Record<string, unknown>>(
	handle: SqliteHandle<TSchema>,
	config: MigrationConfig,
): void {
	const sqlite = drivers.get(handle);
	if (!sqlite) throw new Error("migrateSqlite takes a handle from openSqlite");
	migrate(drizzle({ client: sqlite }), config);
}
