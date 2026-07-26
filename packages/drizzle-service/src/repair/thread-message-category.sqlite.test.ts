import { messageTable } from "../schema/message-data.js";
import { threadMessageTable } from "../schema/thread-message.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import type { RepairSqlClient } from "./thread-message-category.js";
import { describeRepairContract } from "./thread-message-category-contract.js";

// The repair against a real better-sqlite3 database — the engine every self-host
// instance runs, and the one whose `unixepoch()` and single-writer serialization
// the statement leans on.
describeRepairContract("sqlite", async () => {
	const { sqlite, close } = await createSqliteTestDb({
		message: messageTable,
		threadMessage: threadMessageTable,
	});

	const client: RepairSqlClient = {
		dialect: "sqlite",
		all: async (sql) => sqlite.prepare(sql).all(),
		run: async (sql) => sqlite.prepare(sql).run().changes,
	};

	return {
		client,
		reset: async () => {
			sqlite.exec("DELETE FROM thread_message");
			sqlite.exec("DELETE FROM message");
		},
		close,
	};
});
