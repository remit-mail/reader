import { existsSync } from "node:fs";
import {
	DatabaseSync,
	type SQLInputValue,
	type SQLOutputValue,
	type StatementSync,
} from "node:sqlite";
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
}

export interface SqliteStatement {
	all(...params: unknown[]): unknown[];
	get(...params: unknown[]): unknown;
	run(...params: unknown[]): { changes: number };
	iterate(...params: unknown[]): IterableIterator<unknown>;
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

const isSqlInput = (value: unknown): value is SQLInputValue =>
	value === null ||
	typeof value === "number" ||
	typeof value === "bigint" ||
	typeof value === "string" ||
	ArrayBuffer.isView(value);

const bind = (params: unknown[]): SQLInputValue[] =>
	params.map((value) => {
		if (isSqlInput(value)) return value;
		throw new TypeError(`SQLite cannot bind a ${typeof value} parameter`);
	});

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
	all: (...params) => prepared.all(...bind(params)).map((row) => ({ ...row })),
	get: (...params) => plain(prepared.get(...bind(params))),
	run: (...params) => ({
		changes: Number(prepared.run(...bind(params)).changes),
	}),
	iterate: (...params) => plainRows(prepared.iterate(...bind(params))),
});

// A writable database runs in WAL mode, and every handle waits up to 5 s on a
// lock another connection holds. node:sqlite has no fileMustExist, so a file
// opened rather than created is checked before the open would create it.
export function openSqlite<TSchema extends Record<string, unknown>>(
	options: OpenSqliteOptions<TSchema>,
): SqliteHandle<TSchema> {
	if (options.mode !== "create" && !existsSync(options.filename)) {
		throw new Error(`SQLite database ${options.filename} does not exist`);
	}
	const sqlite = new DatabaseSync(options.filename, {
		readOnly: options.mode === "readonly",
	});
	if (options.mode !== "readonly") sqlite.exec("PRAGMA journal_mode = WAL");
	sqlite.exec("PRAGMA busy_timeout = 5000");
	sqlite.exec(`PRAGMA synchronous = ${options.synchronous}`);
	sqlite.exec("PRAGMA foreign_keys = ON");

	const db = drizzle({ client: sqlite });
	const connection: SqliteConnection = {
		prepare: (source) => statement(sqlite.prepare(source)),
	};
	drivers.set(connection, sqlite);
	const handle: SqliteHandle<TSchema> = {
		db,
		sqlite: connection,
		exec: (sql) => {
			sqlite.exec(sql);
		},
		immediate: (work) => {
			sqlite.exec("BEGIN IMMEDIATE");
			try {
				const result = work();
				sqlite.exec("COMMIT");
				return result;
			} catch (error) {
				if (sqlite.isTransaction) sqlite.exec("ROLLBACK");
				throw error;
			}
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

// The driver behind a handle or its connection, for a test that watches the
// statements drizzle prepares.
export function sqliteDriver(owner: object): DatabaseSync {
	const sqlite = drivers.get(owner);
	if (!sqlite) throw new Error("sqliteDriver takes a handle from openSqlite");
	return sqlite;
}

export function migrateSqlite<TSchema extends Record<string, unknown>>(
	handle: SqliteHandle<TSchema>,
	config: MigrationConfig,
): void {
	migrate(drizzle({ client: sqliteDriver(handle) }), config);
}
