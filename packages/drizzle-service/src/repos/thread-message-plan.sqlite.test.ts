import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { NODE_SQLITE_LIMITS } from "../bound-parameters.js";
import { createSqliteRepositories } from "../sqlite-repositories.js";
import {
	assertPlanSearches,
	queryPlan,
	selectsIssuedDuring,
} from "../test-query-plan.js";
import { createShippedSqliteDb, sharedDatabases } from "../test-sqlite.js";
import { messageObjectsInMemory } from "./message-objects.js";

describe("thread-message lookups without sqlite_stat1", () => {
	const { db, sqlite, close } = createShippedSqliteDb();
	after(close);
	const repos = createSqliteRepositories(
		sharedDatabases(db),
		NODE_SQLITE_LIMITS,
		messageObjectsInMemory(),
	);
	const repo = repos.threadMessage;

	const planDuring = async (run: () => Promise<unknown>): Promise<string[]> =>
		queryPlan(sqlite, await selectsIssuedDuring(run));

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

	test("message syncSearch reads listings through thread_message_by_message_id without the tenant", async () => {
		assertPlanSearches(
			(
				await planDuring(() => repos.message.syncSearch(["msg-1", "msg-2"]))
			).filter((detail) => !detail.includes("json_each")),
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

	test("searchByMailboxWindow under senderTrust and dkimMismatch probes address and message by index", async () => {
		const plan = await planDuring(() =>
			repo.searchByMailboxWindow(
				"acct",
				"junk",
				{ senderTrust: ["vip", "wellknown"], dkimMismatch: false },
				{ excludeDeleted: true, limit: 500 },
			),
		);
		const accesses = (table: string) =>
			plan.filter((detail) => detail.startsWith(`SEARCH ${table} `));

		assertPlanSearches(
			accesses("thread_message"),
			"thread_message_by_mailbox_id",
		);
		assertPlanSearches(accesses("address"), "address_by_normalized_email");
		assert.deepEqual(accesses("message"), [
			"SEARCH message EXISTS USING INDEX sqlite_autoindex_message_1 (message_id=?)",
		]);
		assert.ok(
			!plan.some((detail) =>
				/^SCAN (thread_message|address|message)\b/.test(detail),
			),
			`a filtered search fell back to a scan: ${plan.join(" | ")}`,
		);
	});

	for (const order of ["asc", "desc"] as const) {
		test(`listByThread ${order} searches thread_message_by_thread_id`, async () => {
			assertPlanSearches(
				await planDuring(() =>
					repo.listByThread("thread", "acct", {
						order,
						excludeDeleted: true,
					}),
				),
				"thread_message_by_thread_id",
			);
		});
	}
});
