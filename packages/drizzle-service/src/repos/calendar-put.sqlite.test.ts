import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
	prepareCalendarObject,
	provisionDefaultCalendar,
	putCalendarObject,
} from "@remit/calendar-service";
import type {
	CalendarRepositories,
	CalendarWrite,
	ICalendarStore,
} from "@remit/data-ports";
import type { Db } from "../db.js";
import {
	calendarEventIndexTable,
	calendarObjectTable,
	calendarTable,
} from "../schema.js";
import { createSqliteRepositories } from "../sqlite-repositories.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";

const ACCOUNT_CONFIG_ID = "account-config-1";

const RESOURCE = [
	"BEGIN:VCALENDAR",
	"VERSION:2.0",
	"BEGIN:VEVENT",
	"UID:atomic@example.com",
	"DTSTART:20260826T090000Z",
	"DTEND:20260826T100000Z",
	"SUMMARY:Quarterly review",
	"RRULE:FREQ=WEEKLY;COUNT=3",
	"END:VEVENT",
	"END:VCALENDAR",
	"",
].join("\r\n");

/**
 * Appends a write that fails to every commit: a resource put into a collection
 * that does not exist, which the store refuses at its last statement. Every
 * statement of the real write set has run by then, so a failure there is the
 * case that proves the boundary.
 */
class FailingLastWriteStore implements ICalendarStore {
	constructor(private inner: ICalendarStore) {}

	get repos(): CalendarRepositories {
		return this.inner.repos;
	}

	async commit(writes: readonly CalendarWrite[]): Promise<void> {
		const orphan = await prepareCalendarObject(
			{ timezone: "" },
			{
				accountConfigId: ACCOUNT_CONFIG_ID,
				calendarId: "no-such-calendar",
				resourceName: "orphan.ics",
				icalData: RESOURCE,
			},
		);
		assert.ok(orphan.ok);
		await this.inner.commit([...writes, orphan.value]);
	}
}

describe("the calendar write path against sqlite", () => {
	let db: Db<Record<string, unknown>>;
	let close: () => Promise<void>;
	let store: ICalendarStore;
	let calendarId: string;

	before(async () => {
		const created = await createSqliteTestDb({
			calendars: calendarTable,
			calendarObjects: calendarObjectTable,
			calendarEventIndexes: calendarEventIndexTable,
		});
		db = created.db as unknown as Db<Record<string, unknown>>;
		close = created.close;
		store = createSqliteRepositories({
			app: db,
			mail: db,
			search: db,
		}).calendarStore;
		const collection = await provisionDefaultCalendar(store, ACCOUNT_CONFIG_ID);
		calendarId = collection.calendarId;
	});

	after(() => close());

	const objects = () => db.select().from(calendarObjectTable);
	const occurrences = () => db.select().from(calendarEventIndexTable);

	test("writes the object, its occurrences and the sequence bump together", async () => {
		const result = await putCalendarObject(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			resourceName: "review.ics",
			icalData: RESOURCE,
		});

		assert.ok(result.ok);
		assert.equal(result.value.icalData, RESOURCE);
		assert.equal(
			(await objects())[0]?.icalData,
			RESOURCE,
			"the stored row holds the input bytes, CRLF and all",
		);
		assert.equal(result.value.syncSequence, 1);
		assert.equal((await objects()).length, 1);
		assert.equal(
			(await occurrences()).filter(
				(row) => row.calendarObjectId === result.value.calendarObjectId,
			).length,
			3,
		);
	});

	test("a failing write in the batch leaves no object behind", async () => {
		const before = await objects();

		await assert.rejects(
			putCalendarObject(new FailingLastWriteStore(store), {
				accountConfigId: ACCOUNT_CONFIG_ID,
				calendarId,
				resourceName: "doomed.ics",
				icalData: RESOURCE,
			}),
			/NOT NULL constraint failed/,
		);

		const after = await objects();
		assert.equal(after.length, before.length);
		assert.equal(
			after.some((row) => row.resourceName === "doomed.ics"),
			false,
		);
	});

	test("a failing write in the batch leaves the collection's sequence where it was", async () => {
		const [before] = await db.select().from(calendarTable);

		await assert.rejects(
			putCalendarObject(new FailingLastWriteStore(store), {
				accountConfigId: ACCOUNT_CONFIG_ID,
				calendarId,
				resourceName: "doomed-again.ics",
				icalData: RESOURCE,
			}),
			/NOT NULL constraint failed/,
		);

		const [after] = await db.select().from(calendarTable);
		assert.equal(after?.syncSequence, before?.syncSequence);
	});

	test("a refused resource writes nothing at all", async () => {
		const before = await objects();
		const [collectionBefore] = await db.select().from(calendarTable);

		const result = await putCalendarObject(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			resourceName: "backwards.ics",
			icalData: [
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				"BEGIN:VEVENT",
				"UID:backwards@example.com",
				"DTSTART:20260826T100000Z",
				"DTEND:20260826T090000Z",
				"END:VEVENT",
				"END:VCALENDAR",
				"",
			].join("\r\n"),
		});

		assert.ok(!result.ok);
		assert.equal(result.error.code, "BackwardsEnd");
		assert.equal((await objects()).length, before.length);
		const [collectionAfter] = await db.select().from(calendarTable);
		assert.equal(collectionAfter?.syncSequence, collectionBefore?.syncSequence);
	});

	test("rewriting a resource replaces its occurrences rather than adding to them", async () => {
		const first = await putCalendarObject(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			resourceName: "shrinking.ics",
			icalData: RESOURCE,
		});
		assert.ok(first.ok);

		const second = await putCalendarObject(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			resourceName: "shrinking.ics",
			icalData: RESOURCE.replace("COUNT=3", "COUNT=1"),
		});
		assert.ok(second.ok);

		assert.equal(second.value.calendarObjectId, first.value.calendarObjectId);
		assert.equal(
			(await occurrences()).filter(
				(row) => row.calendarObjectId === second.value.calendarObjectId,
			).length,
			1,
		);
	});
});
