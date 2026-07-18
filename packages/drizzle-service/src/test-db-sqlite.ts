import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { pushSQLiteSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Db } from "./db.js";

// The exact FTS5 objects the migrator installs (RFC 036 D4), read from the one
// committed source so a test runs the real search path, not a hand-copied twin.
const searchIndexDdl = (): string =>
	readFileSync(
		new URL("../../../npm-scripts/sqlite-search-index.sql", import.meta.url),
		"utf8",
	);

// SQLite counterpart of repos/test-helpers.ts's embedded-Postgres harness
// (RFC 036 D1). A real better-sqlite3 database (in-memory by default) with the
// schema pushed from the drizzle table objects — the sqlite `pushSchema` — so a
// repo runs against the exact dialect it ships on, no hand-maintained DDL.
//
// The tests that use it run in a `DATA_BACKEND=sqlite` process (see
// test:run:sqlite), so the schema facades resolve to the sqlite tables and the
// repos take the sqlite transaction / predicate paths.

export type SqliteTestDb<TSchema extends Record<string, unknown>> = Db<TSchema>;

export async function createSqliteTestDb<
	TSchema extends Record<string, unknown>,
>(
	schema: TSchema,
	options?: { filename?: string; searchIndex?: boolean },
): Promise<{
	db: SqliteTestDb<TSchema>;
	sqlite: Database.Database;
	close: () => Promise<void>;
}> {
	const sqlite = new Database(options?.filename ?? ":memory:");
	sqlite.pragma("foreign_keys = ON");

	const db = drizzle(sqlite, { schema }) as unknown as SqliteTestDb<TSchema>;

	// pushSQLiteSchema derives the CREATE statements from the table objects;
	// better-sqlite3 rejects its own `apply()` (it issues the DDL through a
	// data-returning path), so run the statements directly. The pull-schema
	// progress spinner writes to stdout — silence it so the test reporter output
	// stays clean.
	const write = process.stdout.write.bind(process.stdout);
	process.stdout.write = (() => true) as typeof process.stdout.write;
	let statementsToExecute: string[];
	try {
		({ statementsToExecute } = await pushSQLiteSchema(
			schema,
			db as unknown as Parameters<typeof pushSQLiteSchema>[1],
		));
	} finally {
		process.stdout.write = write;
	}
	for (const statement of statementsToExecute) {
		sqlite.exec(statement);
	}

	// Install the FTS5 search objects on top of the pushed schema so the
	// thread-message search predicates run their real trigram path (RFC 036 D4).
	// Opt-in: only schemas that include the `thread_message` table can carry it.
	if (options?.searchIndex) {
		sqlite.exec(searchIndexDdl());
	}

	return {
		db,
		sqlite,
		close: async () => {
			sqlite.close();
		},
	};
}
