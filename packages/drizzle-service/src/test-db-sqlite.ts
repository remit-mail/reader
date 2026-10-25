import Database from "better-sqlite3";
import { pushSQLiteSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { syncBatch, type WriteBatch } from "./batch.js";
import type { Db } from "./db.js";
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
	batch: WriteBatch;
	sqlite: Database.Database;
	close: () => Promise<void>;
}> {
	const sqlite = new Database(options?.filename ?? ":memory:");
	sqlite.pragma("foreign_keys = ON");

	const db: SqliteTestDb<TSchema> = drizzle(sqlite, { schema });

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
	// thread-message search predicates run their real trigram path. The one
	// handle then plays both the mail and the search database.
	if (options?.searchIndex) {
		applyMigrationSet(sqlite, "search");
	}

	return {
		db,
		batch: syncBatch(db),
		sqlite,
		close: async () => {
			sqlite.close();
		},
	};
}
