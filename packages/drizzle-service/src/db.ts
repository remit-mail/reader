import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

/**
 * The drizzle handle a repository runs on.
 *
 * Internal to this adapter: it names better-sqlite3, so it is not exported from
 * the package index and never appears on a shared surface.
 */
export type Db<TSchema extends Record<string, unknown>> =
	BetterSQLite3Database<TSchema>;
