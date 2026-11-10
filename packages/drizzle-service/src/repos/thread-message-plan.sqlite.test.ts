import { after, describe, test } from "node:test";
import { assertPlanUsesIndex } from "../test-query-plan.js";
import { createShippedSqliteDb } from "../test-sqlite.js";
import {
	countThreadMembers,
	selectThreadMembers,
	selectThreadMessagesByMessageId,
} from "./thread-message.js";

describe("thread-message lookups without sqlite_stat1", () => {
	const { db, sqlite, close } = createShippedSqliteDb();
	after(close);

	test("by message id searches thread_message_by_message_id", () => {
		assertPlanUsesIndex(
			sqlite,
			selectThreadMessagesByMessageId(db, "acct", "msg"),
			"thread_message_by_message_id",
		);
		assertPlanUsesIndex(
			sqlite,
			selectThreadMessagesByMessageId(db, "acct", "msg").limit(1),
			"thread_message_by_message_id",
		);
	});

	test("the members of a thread search thread_message_by_thread_id", () => {
		assertPlanUsesIndex(
			sqlite,
			selectThreadMembers(db, "acct", "thread"),
			"thread_message_by_thread_id",
		);
	});

	test("the count of a thread searches thread_message_by_thread_id", () => {
		assertPlanUsesIndex(
			sqlite,
			countThreadMembers(db, "acct", "thread"),
			"thread_message_by_thread_id",
		);
	});
});
