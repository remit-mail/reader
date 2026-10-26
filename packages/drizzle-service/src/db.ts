import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { WriteBatch } from "./batch.js";

/**
 * A synchronous SQLite handle: better-sqlite3, or a Cloudflare Durable
 * Object's `durable-sqlite`. Only `syncBatch` and the better-sqlite3
 * composition name it; a repository never does.
 */
export type Db<TSchema extends Record<string, unknown>> = BaseSQLiteDatabase<
	"sync",
	unknown,
	TSchema
>;

/**
 * The handle a repository runs on: any SQLite driver, synchronous or not
 * (better-sqlite3, Durable Object storage, D1, libsql). It has no
 * `transaction` and no `batch`, so a repository writes a set through the
 * injected `WriteBatch` and cannot open an interactive transaction (C5).
 */
export type RepositoryDb<TSchema extends Record<string, unknown>> = Omit<
	BaseSQLiteDatabase<"sync" | "async", unknown, TSchema>,
	"transaction" | "batch"
>;

export interface SqliteStore<TSchema extends Record<string, unknown>> {
	db: RepositoryDb<TSchema>;
	batch: WriteBatch;
	maxBoundParameters: number;
}
