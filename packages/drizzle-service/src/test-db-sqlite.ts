import { pushSchema } from "drizzle-kit/payload/sqlite";
import type { Db } from "./db.js";
import {
	openSqlite,
	openTestSqlite,
	type SqliteConnection,
	type SqliteHandle,
} from "./sqlite.js";
import { statementLog } from "./test-query-plan.js";
import { applyMigrationSet } from "./test-shipped-sqlite-schema.js";

// A real SQLite database (in-memory by default) with the schema pushed
// from the drizzle table objects — the sqlite `pushSchema` — so a repo runs
// against the exact engine it ships on, no hand-maintained DDL.

export async function createSqliteTestDb(
	schema: Record<string, unknown>,
	options?: { filename?: string; searchIndex?: boolean },
): Promise<{
	db: Db;
	sqlite: SqliteConnection;
	exec: (sql: string) => void;
	immediate: SqliteHandle["immediate"];
	close: () => Promise<void>;
}> {
	const sqlite = options?.filename
		? openSqlite({
				filename: options.filename,
				mode: "create",
				synchronous: "OFF",
				logger: statementLog,
			})
		: openTestSqlite(statementLog);

	// pushSchema derives the CREATE statements from the table objects by
	// diffing them against the live database through this client.
	const client: Parameters<typeof pushSchema>[1] = {
		query: async <T>(sql: string) => sqlite.sqlite.prepare(sql).all() as T[],
		run: async (sql: string) => {
			sqlite.exec(sql);
		},
		batch: async (statements: string[]) => {
			for (const statement of statements) sqlite.exec(statement);
		},
	};
	const { apply } = await pushSchema(schema, client);
	await apply();

	// Install the committed search set beside the pushed schema so the
	// thread-message search predicates run their real FTS5 path. The one
	// handle then plays both the mail and the search database.
	if (options?.searchIndex) {
		applyMigrationSet(sqlite, "search");
	}

	return {
		db: sqlite.db,
		sqlite: sqlite.sqlite,
		exec: sqlite.exec,
		immediate: sqlite.immediate,
		close: async () => {
			sqlite.close();
		},
	};
}
