import type { CreateMailboxResult, MailboxItem } from "@remit/data-ports";
import type { Db } from "../db.js";
import { messageDataSchema } from "../schema/message-data.js";
import type { SqliteConnection, SqliteHandle } from "../sqlite.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";

/**
 * The message-data tables on a throwaway in-memory SQLite database — the
 * harness for the repos that only touch that subset.
 */
export async function createTestDb(): Promise<{
	db: Db;
	sqlite: SqliteConnection;
	exec: (sql: string) => void;
	immediate: SqliteHandle["immediate"];
	stop: () => Promise<void>;
}> {
	const { db, sqlite, exec, immediate, close } =
		await createSqliteTestDb(messageDataSchema);
	return { db, sqlite, exec, immediate, stop: close };
}

export const mailboxCreated = (result: CreateMailboxResult): MailboxItem => {
	if (result.outcome !== "Created") {
		throw new Error("The account already has a folder at that path");
	}
	return result.mailbox;
};
