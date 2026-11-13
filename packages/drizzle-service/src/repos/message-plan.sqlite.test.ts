import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { NODE_SQLITE_LIMITS } from "../bound-parameters.js";
import { createSqliteRepositories } from "../sqlite-repositories.js";
import {
	assertPlanSearches,
	queryPlan,
	selectsIssuedDuring,
} from "../test-query-plan.js";
import { createShippedSqliteDb } from "../test-sqlite.js";
import { messageObjectsInMemory } from "./message-objects.js";

describe("message lookups without sqlite_stat1", () => {
	const { db, sqlite, close } = createShippedSqliteDb();
	after(close);
	const repos = createSqliteRepositories(
		{ app: db, mail: db, search: db },
		NODE_SQLITE_LIMITS,
		messageObjectsInMemory(),
	);

	test("listSenderJunk searches the Junk folder and probes each sender by message", async () => {
		const plan = queryPlan(
			sqlite,
			await selectsIssuedDuring(() =>
				repos.message.listSenderJunk("junk", "news@example.com", 25),
			),
		);
		const accesses = (table: string) =>
			plan.filter(
				(detail) =>
					/^(SCAN|SEARCH) /.test(detail) && detail.split(" ")[1] === table,
			);

		assertPlanSearches(accesses("message"), "message_by_mailbox_id");
		assert.deepEqual(accesses("envelope_address"), [
			"SEARCH envelope_address EXISTS USING INDEX envelope_address_by_message_id (message_id=?)",
		]);
	});
});
