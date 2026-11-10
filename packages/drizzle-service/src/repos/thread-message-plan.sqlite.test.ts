import { after, describe, test } from "node:test";
import { BETTER_SQLITE3_LIMITS } from "../bound-parameters.js";
import { createSqliteRepositories } from "../sqlite-repositories.js";
import {
	assertPlanSearches,
	queryPlan,
	selectsIssuedDuring,
} from "../test-query-plan.js";
import { createShippedSqliteDb } from "../test-sqlite.js";
import { messageObjectsInMemory } from "./message-objects.js";

describe("thread-message lookups without sqlite_stat1", () => {
	const { db, sqlite, close } = createShippedSqliteDb();
	after(close);
	const repo = createSqliteRepositories(
		{ app: db, mail: db, search: db },
		BETTER_SQLITE3_LIMITS,
		messageObjectsInMemory(),
	).threadMessage;

	const planDuring = async (run: () => Promise<unknown>): Promise<string[]> =>
		queryPlan(sqlite, await selectsIssuedDuring(sqlite, run));

	test("findByMessageId searches thread_message_by_message_id", async () => {
		assertPlanSearches(
			await planDuring(() => repo.findByMessageId("acct", "msg")),
			"thread_message_by_message_id",
		);
	});

	test("findAllByMessageId searches thread_message_by_message_id", async () => {
		assertPlanSearches(
			await planDuring(() => repo.findAllByMessageId("acct", "msg")),
			"thread_message_by_message_id",
		);
	});

	test("rekeyThread reads the thread through thread_message_by_thread_id", async () => {
		assertPlanSearches(
			await planDuring(() => repo.rekeyThread("acct", "from", "to")),
			"thread_message_by_thread_id",
		);
	});

	test("countByThread searches thread_message_by_thread_id", async () => {
		assertPlanSearches(
			await planDuring(() => repo.countByThread("acct", "thread")),
			"thread_message_by_thread_id",
		);
	});
});
