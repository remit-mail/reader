import { existsSync } from "node:fs";
import {
	DatabaseSync,
	type SQLOutputValue,
	type StatementSync,
} from "node:sqlite";
import type { Logger } from "drizzle-orm/logger";
import type { MigrationConfig } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import type { Db } from "./db.js";

export type { Db } from "./db.js";

export type SqliteMode = "create" | "open" | "readonly";

export type SqliteSynchronous = "OFF" | "NORMAL" | "FULL";

export interface OpenSqliteOptions<TSchema extends Record<string, unknown>> {
	filename: string;
	mode: SqliteMode;
	synchronous: SqliteSynchronous;
	schema: TSchema;
	logger?: Logger;
}

export type SqliteValue = null | number | bigint | string | Uint8Array;

export interface SqliteStatement {
	all(...params: SqliteValue[]): unknown[];
	get(...params: SqliteValue[]): unknown;
	run(...params: SqliteValue[]): { changes: number };
	iterate(...params: SqliteValue[]): IterableIterator<unknown>;
}

export interface SqliteConnection {
	prepare(source: string): SqliteStatement;
}

export interface SqliteHandle<TSchema extends Record<string, unknown>> {
	db: Db<TSchema>;
	sqlite: SqliteConnection;
	exec(sql: string): void;
	immediate<T>(work: () => T): T;
	close(): void;
}

const drivers = new WeakMap<object, DatabaseSync>();

const plain = (
	row: Record<string, SQLOutputValue> | undefined,
): Record<string, SQLOutputValue> | undefined => (row ? { ...row } : row);

function* plainRows(
	rows: Iterator<Record<string, SQLOutputValue>>,
): IterableIterator<unknown> {
	for (let next = rows.next(); !next.done; next = rows.next()) {
		yield { ...next.value };
	}
}

const statement = (prepared: StatementSync): SqliteStatement => ({
	all: (...params) => prepared.all(...params).map((row) => ({ ...row })),
	get: (...params) => plain(prepared.get(...params)),
	run: (...params) => ({
		changes: Number(prepared.run(...params).changes),
	}),
	iterate: (...params) => plainRows(prepared.iterate(...params)),
});

// A writable database runs in WAL mode, and every handle waits up to 5 s on a
// lock another connection holds, from the open on, so a second process
// switching the file to WAL at startup waits instead of failing busy. node:sqlite
// enforces foreign keys by default. node:sqlite has no fileMustExist, so a file
// opened rather than created is checked before the open would create it.
export function openSqlite<TSchema extends Record<string, unknown>>(
	options: OpenSqliteOptions<TSchema>,
): SqliteHandle<TSchema> {
	if (options.mode !== "create" && !existsSync(options.filename)) {
		throw new Error(`SQLite database ${options.filename} does not exist`);
	}
	const sqlite = new DatabaseSync(options.filename, {
		readOnly: options.mode === "readonly",
		timeout: 5000,
	});
	if (options.mode !== "readonly") sqlite.exec("PRAGMA journal_mode = WAL");
	sqlite.exec(`PRAGMA synchronous = ${options.synchronous}`);

	const db = drizzle({ client: sqlite, logger: options.logger });
	const handle: SqliteHandle<TSchema> = {
		db,
		sqlite: { prepare: (source) => statement(sqlite.prepare(source)) },
		exec: (sql) => {
			sqlite.exec(sql);
		},
		immediate: (work) =>
			db.transaction(() => ({ value: work() }), { behavior: "immediate" })
				.value,
		close: () => {
			sqlite.close();
		},
	};
	drivers.set(handle, sqlite);
	return handle;
}

export function openTestSqlite<TSchema extends Record<string, unknown>>(
	schema: TSchema,
	logger?: Logger,
): SqliteHandle<TSchema> {
	return openSqlite({
		filename: ":memory:",
		mode: "create",
		synchronous: "OFF",
		schema,
		logger,
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
