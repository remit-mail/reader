import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

/**
 * The drizzle handle a repository runs on: any synchronous SQLite driver.
 *
 * better-sqlite3 is the one this package opens; a Cloudflare Durable Object's
 * `durable-sqlite` handle satisfies it too, so its adapter constructs the same
 * repositories over its own storage.
 */
export type Db<TSchema extends Record<string, unknown>> = BaseSQLiteDatabase<
	"sync",
	unknown,
	TSchema
>;
