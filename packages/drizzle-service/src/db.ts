import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";

/**
 * A drizzle handle a repository can run on: the top-level database or a
 * transaction (or savepoint) bound to one. Both share the query-builder API, so
 * a repo constructed with either behaves the same — standalone, or enlisted in a
 * unit-of-work transaction.
 */
export type Db<TSchema extends Record<string, unknown>> = PgDatabase<
	NodePgQueryResultHKT,
	TSchema
>;
