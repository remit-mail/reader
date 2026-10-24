import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import { runBatch } from "./batch.js";
import { calendarTable } from "./schema.js";
import { createSqliteTestDb, type SqliteTestDb } from "./test-db-sqlite.js";

const SCHEMA = { calendars: calendarTable };

const collection = (calendarId: string): typeof calendarTable.$inferInsert => ({
	calendarId,
	accountConfigId: "account-config-batch",
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

describe("a batch on better-sqlite3", () => {
	let db: SqliteTestDb<typeof SCHEMA>;
	let close: () => Promise<void>;

	before(async () => {
		({ db, close } = await createSqliteTestDb(SCHEMA));
	});

	after(() => close());

	const stored = () => db.select().from(calendarTable);

	test("answers each statement in order, reads seeing the writes before them", async () => {
		const [inserted, read] = await runBatch(db, [
			db.insert(calendarTable).values(collection("first")).returning(),
			db
				.select()
				.from(calendarTable)
				.where(eq(calendarTable.calendarId, "first")),
		] as const);

		assert.deepEqual(
			inserted.map((row) => row.calendarId),
			["first"],
		);
		assert.deepEqual(
			read.map((row) => row.calendarId),
			["first"],
		);
	});

	test("a statement that fails takes every earlier one with it", async () => {
		const before = await stored();

		await assert.rejects(
			runBatch(db, [
				db.insert(calendarTable).values(collection("second")),
				db
					.update(calendarTable)
					.set({ syncSequence: 7 })
					.where(eq(calendarTable.calendarId, "first")),
				db.insert(calendarTable).values(collection("first")),
			]),
			/UNIQUE constraint failed/,
		);

		assert.deepEqual(await stored(), before);
	});

	test("an empty batch writes nothing and answers nothing", async () => {
		assert.deepEqual(await runBatch(db, []), []);
	});
});
