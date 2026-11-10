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

describe("message lookups without sqlite_stat1", () => {
	const { db, sqlite, close } = createShippedSqliteDb();
	after(close);
	const repos = createSqliteRepositories(
		{ app: db, mail: db, search: db },
		BETTER_SQLITE3_LIMITS,
		messageObjectsInMemory(),
	);

	test("listUndecidedJunkBacklog searches message_by_mailbox_id", async () => {
		assertPlanSearches(
			queryPlan(
				sqlite,
				await selectsIssuedDuring(sqlite, () =>
					repos.message.listUndecidedJunkBacklog("junk", 1, 25),
				),
			),
			"message_by_mailbox_id",
		);
	});
});
