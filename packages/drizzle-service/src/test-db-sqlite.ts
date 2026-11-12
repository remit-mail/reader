import type Database from "better-sqlite3";
import { pushSQLiteSchema } from "drizzle-kit/api";
import type { Db } from "./db.js";
import { MEMORY, openSqlite } from "./sqlite.js";
import { applyMigrationSet } from "./test-shipped-sqlite-schema.js";

// A real better-sqlite3 database (in-memory by default) with the schema pushed
// from the drizzle table objects — the sqlite `pushSchema` — so a repo runs
// against the exact engine it ships on, no hand-maintained DDL.

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
	const opened = openSqlite({
		filename: options?.filename ?? MEMORY,
		readonly: false,
		mustExist: false,
		synchronous: "OFF",
		schema,
	});
	const sqlite = opened.$client;

	const db: SqliteTestDb<TSchema> = opened;

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

	// Install the committed search set beside the pushed schema so the
	// thread-message search predicates run their real FTS5 path. The one
	// handle then plays both the mail and the search database.
	if (options?.searchIndex) {
		applyMigrationSet(sqlite, "search");
	}

	return {
		db,
		sqlite,
		close: async () => {
			sqlite.close();
		},
	};
}
