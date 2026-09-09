import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
	provisionDefaultCalendar,
	putCalendarObject,
} from "@remit/calendar-service";
import type {
	CalendarUnitOfWorkRepositories,
	ICalendarUnitOfWork,
} from "@remit/data-ports";
import type { Db } from "../db.js";
import {
	calendarEventIndexTable,
	calendarObjectTable,
	calendarTable,
} from "../schema.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import { DrizzleCalendarUnitOfWork } from "./calendar-unit-of-work.js";

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
 * Fails the third of the write set's three writes. The occurrence rows are
 * written last, so a failure there is the case that proves the boundary: the
 * object row and the sequence bump are already in the transaction when it
 * happens.
 */
class FailingIndexUnitOfWork implements ICalendarUnitOfWork {
	constructor(private inner: ICalendarUnitOfWork) {}

	transaction<T>(
		fn: (repos: CalendarUnitOfWorkRepositories) => Promise<T>,
	): Promise<T> {
		return this.inner.transaction((repos) =>
			fn({
				...repos,
				calendarEventIndex: {
					...repos.calendarEventIndex,
					replaceForObject: () => {
						throw new Error("the index write failed");
					},
				},
			}),
		);
	}
}

describe("the calendar write path against sqlite", () => {
	let db: Db<Record<string, unknown>>;
	let close: () => Promise<void>;
	let unitOfWork: ICalendarUnitOfWork;
	let calendarId: string;

	before(async () => {
		const created = await createSqliteTestDb({
			calendars: calendarTable,
			calendarObjects: calendarObjectTable,
			calendarEventIndexes: calendarEventIndexTable,
		});
		db = created.db as unknown as Db<Record<string, unknown>>;
		close = created.close;
		unitOfWork = new DrizzleCalendarUnitOfWork(db);
		const collection = await provisionDefaultCalendar(
			unitOfWork,
			ACCOUNT_CONFIG_ID,
		);
		calendarId = collection.calendarId;
	});

	after(() => close());

	const objects = () => db.select().from(calendarObjectTable);
	const occurrences = () => db.select().from(calendarEventIndexTable);

	test("writes the object, its occurrences and the sequence bump together", async () => {
		const result = await putCalendarObject(unitOfWork, {
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

	test("a failing index write leaves no object behind", async () => {
		const before = await objects();

		await assert.rejects(
			putCalendarObject(new FailingIndexUnitOfWork(unitOfWork), {
				accountConfigId: ACCOUNT_CONFIG_ID,
				calendarId,
				resourceName: "doomed.ics",
				icalData: RESOURCE,
			}),
			/the index write failed/,
		);

		const after = await objects();
		assert.equal(after.length, before.length);
		assert.equal(
			after.some((row) => row.resourceName === "doomed.ics"),
			false,
		);
	});

	test("a failing index write leaves the collection's sequence where it was", async () => {
		const [before] = await db.select().from(calendarTable);

		await assert.rejects(
			putCalendarObject(new FailingIndexUnitOfWork(unitOfWork), {
				accountConfigId: ACCOUNT_CONFIG_ID,
				calendarId,
				resourceName: "doomed-again.ics",
				icalData: RESOURCE,
			}),
			/the index write failed/,
		);

		const [after] = await db.select().from(calendarTable);
		assert.equal(after?.syncSequence, before?.syncSequence);
	});

	test("a refused resource writes nothing at all", async () => {
		const before = await objects();
		const [collectionBefore] = await db.select().from(calendarTable);

		const result = await putCalendarObject(unitOfWork, {
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
		const first = await putCalendarObject(unitOfWork, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			resourceName: "shrinking.ics",
			icalData: RESOURCE,
		});
		assert.ok(first.ok);

		const second = await putCalendarObject(unitOfWork, {
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
