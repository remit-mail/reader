import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { calendarTable } from "../schema.js";
import { createSqliteTestDb, type SqliteTestDb } from "../test-db-sqlite.js";
import { inList } from "./in-list.js";

const SCHEMA = { calendars: calendarTable };

const calendar = (calendarId: string): typeof calendarTable.$inferInsert => ({
	calendarId,
	accountConfigId: "account-config-in-list",
	urlSegment: calendarId,
	displayName: calendarId,
	color: "Cal1",
	componentSet: "VeventOnly",
	source: "UserCreated",
	timezone: "",
	subscriptionUrl: "",
	subscriptionEnabled: false,
	syncSequence: 0,
	createdAt: 0,
	updatedAt: 0,
});

describe("inList on better-sqlite3", () => {
	let db: SqliteTestDb<typeof SCHEMA>;
	let close: () => Promise<void>;
	const allIds = Array.from({ length: 150 }, (_, index) => `calendar-${index}`);

	before(async () => {
		({ db, close } = await createSqliteTestDb(SCHEMA));
		await db.insert(calendarTable).values(allIds.map(calendar));
	});

	after(() => close());

	test("binds a single parameter for 150 ids", () => {
		const query = db
			.select({ calendarId: calendarTable.calendarId })
			.from(calendarTable)
			.where(inList(calendarTable.calendarId, allIds))
			.toSQL();
		assert.equal(query.params.length, 1);
	});

	test("matches only the listed ids", async () => {
		const rows = await db
			.select({ calendarId: calendarTable.calendarId })
			.from(calendarTable)
			.where(inList(calendarTable.calendarId, ["calendar-3", "missing"]));
		assert.deepEqual(rows, [{ calendarId: "calendar-3" }]);
	});

	test("matches nothing for an empty list", async () => {
		const rows = await db
			.select({ calendarId: calendarTable.calendarId })
			.from(calendarTable)
			.where(inList(calendarTable.calendarId, []));
		assert.deepEqual(rows, []);
	});
});
