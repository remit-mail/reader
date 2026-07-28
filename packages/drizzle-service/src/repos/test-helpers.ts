import type Database from "better-sqlite3";
import type { Db } from "../db.js";
import {
	type MessageDataSchema,
	messageDataSchema,
} from "../schema/message-data.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";

export type TestDb = Db<MessageDataSchema>;

/**
 * The message-data tables on a throwaway in-memory SQLite database — the
 * harness for the repos that only touch that subset.
 */
export async function createTestDb(): Promise<{
	db: TestDb;
	sqlite: Database.Database;
	stop: () => Promise<void>;
}> {
	const { db, sqlite, close } = await createSqliteTestDb(messageDataSchema);
	return { db, sqlite, stop: close };
}
