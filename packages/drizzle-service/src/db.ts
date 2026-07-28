import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

/**
 * A drizzle handle a repository can run on: the top-level database or a
 * transaction (or savepoint) bound to one. Both share the query-builder API, so
 * a repo constructed with either behaves the same — standalone, or enlisted in a
 * unit-of-work transaction.
 *
 * Internal to this adapter: it names better-sqlite3, so it is not exported from
 * the package index and never appears on a shared surface.
 */
export type Db<TSchema extends Record<string, unknown>> =
	BetterSQLite3Database<TSchema>;
