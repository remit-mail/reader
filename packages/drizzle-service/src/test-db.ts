import type Database from "better-sqlite3";
import type { Db } from "./db.js";
import * as schema from "./schema.js";
import { createSqliteTestDb } from "./test-db-sqlite.js";

export type TestDb = Db<typeof schema>;

/**
 * The whole app schema on a throwaway in-memory SQLite database, with the FTS5
 * search objects installed on top — the harness a repo test takes when it needs
 * more tables than its own.
 */
export async function createTestDb(): Promise<{
	db: TestDb;
	sqlite: Database.Database;
	close: () => Promise<void>;
}> {
	return createSqliteTestDb(schema, { searchIndex: true });
}

export { randomId } from "./id.js";
