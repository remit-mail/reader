import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
	CalendarEventStatus,
	CalendarTransparency,
	ZoneCertainty,
} from "@remit/domain-enums";
import { deriveCalendarObjectId } from "../id.js";
import type { ICalendarObjectRepository } from "../interfaces/calendar-object.js";
import type { PutCalendarObjectInput } from "../types.js";
import type { RepositoryConformanceHarness } from "./harness.js";

const ICAL_DATA = [
	"BEGIN:VCALENDAR",
	"VERSION:2.0",
	"BEGIN:VEVENT",
	"UID:conformance@example.com",
	"DTSTART:20260826T090000Z",
	"DTEND:20260826T100000Z",
	"SUMMARY:Stand-up",
	"END:VEVENT",
	"END:VCALENDAR",
	"",
].join("\r\n");

const objectInput = (
	calendarId: string,
	overrides: Partial<PutCalendarObjectInput> = {},
): PutCalendarObjectInput => ({
	calendarId,
	resourceName: "conformance.ics",
	icalUid: "conformance@example.com",
	icalData: ICAL_DATA,
	etag: "a".repeat(64),
	sequence: 0,
	syncSequence: 1,
	summary: "Stand-up",
	dtStart: "2026-08-26T09:00:00+00:00",
	dtEnd: "2026-08-26T10:00:00+00:00",
	allDay: false,
	zoneCertainty: ZoneCertainty.Explicit,
	status: CalendarEventStatus.Confirmed,
	transparency: CalendarTransparency.Opaque,
	hasRecurrence: false,
	expandedThrough: "",
	...overrides,
});

export function calendarObjectRepositoryConformance(
	harness: RepositoryConformanceHarness<ICalendarObjectRepository>,
): void {
	describe("ICalendarObjectRepository conformance", () => {
		let repo: ICalendarObjectRepository;

		before(async () => {
			repo = await harness.createRepository();
		});

		after(() => harness.teardown());

		test("put derives calendarObjectId from the collection and the resource name", async () => {
			const calendarId = harness.makeId();

			const object = await repo.put(objectInput(calendarId));

			assert.equal(
				object.calendarObjectId,
				deriveCalendarObjectId(calendarId, "conformance.ics"),
			);
		});

		test("put stores the iCalendar bytes verbatim, CRLF intact", async () => {
			const calendarId = harness.makeId();

			await repo.put(objectInput(calendarId));
			const stored = await repo.findByResourceName(
				calendarId,
				"conformance.ics",
			);

			assert.equal(stored?.icalData, ICAL_DATA);
			assert.ok(stored?.icalData.includes("\r\n"));
		});

		test("put rewrites the same resource rather than forking a duplicate", async () => {
			const calendarId = harness.makeId();

			await repo.put(objectInput(calendarId));
			const second = await repo.put(
				objectInput(calendarId, {
					summary: "Stand-up (moved)",
					etag: "b".repeat(64),
					syncSequence: 2,
				}),
			);

			assert.equal(second.summary, "Stand-up (moved)");
			assert.equal(second.syncSequence, 2);
			const all = await repo.listByCalendar(calendarId);
			assert.equal(all.length, 1);
		});

		test("get throws a not-found error for a missing resource", async () => {
			await assert.rejects(
				repo.get(harness.makeId(), harness.makeId()),
				(error) => harness.isNotFoundError(error),
			);
		});

		test("find answers with null where get throws", async () => {
			const calendarId = harness.makeId();
			const object = await repo.put(objectInput(calendarId));

			assert.equal(
				(await repo.find(calendarId, object.calendarObjectId))?.icalData,
				ICAL_DATA,
			);
			assert.equal(await repo.find(calendarId, harness.makeId()), null);
			assert.equal(
				await repo.find(harness.makeId(), object.calendarObjectId),
				null,
				"a resource is only found through the collection that holds it",
			);
		});

		test("listIncompleteExpansions returns only the series whose index stops short", async () => {
			const calendarId = harness.makeId();
			await repo.put(objectInput(calendarId, { resourceName: "complete.ics" }));
			const incomplete = await repo.put(
				objectInput(calendarId, {
					resourceName: "incomplete.ics",
					expandedThrough: "2026-01-01T00:00:00Z",
				}),
			);

			assert.deepEqual(
				(
					await repo.listIncompleteExpansions(
						calendarId,
						"2026-06-01T00:00:00Z",
					)
				).map((object) => object.calendarObjectId),
				[incomplete.calendarObjectId],
				"a resource with no expandedThrough is complete and never appears",
			);
			assert.deepEqual(
				await repo.listIncompleteExpansions(calendarId, "2025-06-01T00:00:00Z"),
				[],
				"and one whose index already reaches the window does not either",
			);
		});

		test("findByResourceName returns null for a name the collection does not hold", async () => {
			assert.equal(
				await repo.findByResourceName(harness.makeId(), "absent.ics"),
				null,
			);
		});

		test("findByUid resolves the resource carrying an iCalendar UID", async () => {
			const calendarId = harness.makeId();
			const object = await repo.put(objectInput(calendarId));

			const found = await repo.findByUid(calendarId, "conformance@example.com");
			assert.equal(found?.calendarObjectId, object.calendarObjectId);

			assert.equal(
				await repo.findByUid(calendarId, "absent@example.com"),
				null,
			);
		});

		test("listByCalendar scopes to the collection", async () => {
			const calendarId = harness.makeId();
			const other = harness.makeId();

			const mine = await repo.put(objectInput(calendarId));
			await repo.put(objectInput(other));

			const objects = await repo.listByCalendar(calendarId);
			assert.equal(objects.length, 1);
			assert.equal(objects[0]?.calendarObjectId, mine.calendarObjectId);
		});

		test("listChangedSince returns later writes in change order, excluding the token itself", async () => {
			const calendarId = harness.makeId();

			await repo.put(
				objectInput(calendarId, {
					resourceName: "one.ics",
					icalUid: "one@example.com",
					syncSequence: 1,
				}),
			);
			await repo.put(
				objectInput(calendarId, {
					resourceName: "two.ics",
					icalUid: "two@example.com",
					syncSequence: 2,
				}),
			);
			await repo.put(
				objectInput(calendarId, {
					resourceName: "three.ics",
					icalUid: "three@example.com",
					syncSequence: 3,
				}),
			);

			const changed = await repo.listChangedSince(calendarId, 1);

			assert.deepEqual(
				changed.map((object) => object.resourceName),
				["two.ics", "three.ics"],
			);
		});

		test("delete removes the row", async () => {
			const calendarId = harness.makeId();
			const object = await repo.put(objectInput(calendarId));

			await repo.delete(calendarId, object.calendarObjectId);

			await assert.rejects(
				repo.get(calendarId, object.calendarObjectId),
				(error) => harness.isNotFoundError(error),
			);
		});
	});
}
