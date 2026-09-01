import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CalendarEventStatus, CalendarTransparency } from "@remit/domain-enums";
import {
	CALENDAR_EXPANSION_HORIZON_DAYS,
	CALENDAR_EXPANSION_MAX_OCCURRENCES,
	expandCalendar,
} from "./expand.js";
import { AMSTERDAM_VTIMEZONE, ical, singleEvent } from "./fixtures.js";
import { parseCalendar } from "./parse.js";

const expand = async (icalData: string, timezone = "") => {
	const parsed = await parseCalendar(icalData);
	assert.ok(parsed.ok, `expected a parse, got ${JSON.stringify(parsed)}`);
	return expandCalendar(parsed.value, timezone);
};

const amsterdamSeries = (...eventLines: string[]): string =>
	ical(
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		...AMSTERDAM_VTIMEZONE,
		"BEGIN:VEVENT",
		"UID:weekly@example.com",
		"DTSTART;TZID=Europe/Amsterdam:20261015T090000",
		"DTEND;TZID=Europe/Amsterdam:20261015T100000",
		...eventLines,
		"END:VEVENT",
		"END:VCALENDAR",
	);

describe("expandCalendar", () => {
	it("writes a single occurrence under an empty recurrenceId", async () => {
		const expansion = await expand(
			singleEvent("DTSTART:20260826T090000Z", "DTEND:20260826T100000Z"),
		);

		assert.deepEqual(expansion.occurrences, [
			{
				recurrenceId: "",
				startAt: "2026-08-26T09:00:00Z",
				endAt: "2026-08-26T10:00:00Z",
				allDay: false,
				summary: "",
				status: CalendarEventStatus.Confirmed,
				transparency: CalendarTransparency.Opaque,
			},
		]);
		assert.equal(expansion.expandedThrough, "");
	});

	it("keeps a weekly series at its local hour across the end of DST", async () => {
		// 09:00 in Amsterdam is 07:00Z until the clocks go back on 2026-10-25 and
		// 08:00Z after. An expansion that iterated instants instead of local times
		// would move the meeting an hour for half the year.
		const expansion = await expand(
			amsterdamSeries("RRULE:FREQ=WEEKLY;COUNT=4"),
		);

		assert.deepEqual(
			expansion.occurrences.map((occurrence) => occurrence.startAt),
			[
				"2026-10-15T07:00:00Z",
				"2026-10-22T07:00:00Z",
				"2026-10-29T08:00:00Z",
				"2026-11-05T08:00:00Z",
			],
		);
		assert.equal(expansion.expandedThrough, "");
	});

	it("keeps the same hour when the zone is named but not defined in the resource", async () => {
		const expansion = await expand(
			ical(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				"BEGIN:VEVENT",
				"UID:weekly@example.com",
				"DTSTART;TZID=Europe/Berlin:20261015T090000",
				"DTEND;TZID=Europe/Berlin:20261015T100000",
				"RRULE:FREQ=WEEKLY;COUNT=4",
				"END:VEVENT",
				"END:VCALENDAR",
			),
		);

		assert.deepEqual(
			expansion.occurrences.map((occurrence) => occurrence.startAt),
			[
				"2026-10-15T07:00:00Z",
				"2026-10-22T07:00:00Z",
				"2026-10-29T08:00:00Z",
				"2026-11-05T08:00:00Z",
			],
		);
	});

	it("carries each occurrence's own end", async () => {
		const expansion = await expand(
			amsterdamSeries("RRULE:FREQ=WEEKLY;COUNT=4"),
		);

		assert.deepEqual(
			expansion.occurrences.map((occurrence) => occurrence.endAt),
			[
				"2026-10-15T08:00:00Z",
				"2026-10-22T08:00:00Z",
				"2026-10-29T09:00:00Z",
				"2026-11-05T09:00:00Z",
			],
		);
	});

	it("drops an EXDATEd occurrence and keeps the rest at their slots", async () => {
		const expansion = await expand(
			amsterdamSeries(
				"RRULE:FREQ=WEEKLY;COUNT=4",
				"EXDATE;TZID=Europe/Amsterdam:20261022T090000",
			),
		);

		assert.deepEqual(
			expansion.occurrences.map((occurrence) => occurrence.recurrenceId),
			["2026-10-15T07:00:00Z", "2026-10-29T08:00:00Z", "2026-11-05T08:00:00Z"],
		);
	});

	it("moves an overridden occurrence but keeps the slot it replaces", async () => {
		const expansion = await expand(
			ical(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				...AMSTERDAM_VTIMEZONE,
				"BEGIN:VEVENT",
				"UID:weekly@example.com",
				"DTSTART;TZID=Europe/Amsterdam:20261015T090000",
				"DTEND;TZID=Europe/Amsterdam:20261015T100000",
				"RRULE:FREQ=WEEKLY;COUNT=3",
				"END:VEVENT",
				"BEGIN:VEVENT",
				"UID:weekly@example.com",
				"RECURRENCE-ID;TZID=Europe/Amsterdam:20261022T090000",
				"DTSTART;TZID=Europe/Amsterdam:20261022T140000",
				"DTEND;TZID=Europe/Amsterdam:20261022T150000",
				"END:VEVENT",
				"END:VCALENDAR",
			),
		);

		const moved = expansion.occurrences.find(
			(occurrence) => occurrence.recurrenceId === "2026-10-22T07:00:00Z",
		);
		assert.equal(moved?.startAt, "2026-10-22T12:00:00Z");
		assert.equal(moved?.endAt, "2026-10-22T13:00:00Z");
	});

	it("indexes an override whose slot the rule never produces", async () => {
		// What a client writes after moving one instance and then editing the
		// series: the override's RECURRENCE-ID names a slot the new rule does not
		// generate. The iterator walks only the rule's slots, so nothing but an
		// explicit pass over the VEVENTs reaches this event.
		const expansion = await expand(
			ical(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				...AMSTERDAM_VTIMEZONE,
				"BEGIN:VEVENT",
				"UID:weekly@example.com",
				"DTSTART;TZID=Europe/Amsterdam:20261015T090000",
				"DTEND;TZID=Europe/Amsterdam:20261015T100000",
				"RRULE:FREQ=WEEKLY;COUNT=2",
				"END:VEVENT",
				"BEGIN:VEVENT",
				"UID:weekly@example.com",
				"RECURRENCE-ID;TZID=Europe/Amsterdam:20261112T090000",
				"DTSTART;TZID=Europe/Amsterdam:20261112T140000",
				"DTEND;TZID=Europe/Amsterdam:20261112T153000",
				"END:VEVENT",
				"END:VCALENDAR",
			),
		);

		assert.deepEqual(
			expansion.occurrences.map((occurrence) => occurrence.recurrenceId),
			["2026-10-15T07:00:00Z", "2026-10-22T07:00:00Z", "2026-11-12T08:00:00Z"],
		);
		const stranded = expansion.occurrences.at(-1);
		assert.equal(stranded?.startAt, "2026-11-12T13:00:00Z");
		assert.equal(stranded?.endAt, "2026-11-12T14:30:00Z");
	});

	it("indexes every instance of a resource that has overrides but no rule", async () => {
		const expansion = await expand(
			ical(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				"BEGIN:VEVENT",
				"UID:edited@example.com",
				"DTSTART:20260826T090000Z",
				"DTEND:20260826T100000Z",
				"END:VEVENT",
				"BEGIN:VEVENT",
				"UID:edited@example.com",
				"RECURRENCE-ID:20260902T090000Z",
				"DTSTART:20260902T110000Z",
				"DTEND:20260902T120000Z",
				"END:VEVENT",
				"END:VCALENDAR",
			),
		);

		assert.deepEqual(
			expansion.occurrences.map((occurrence) => occurrence.startAt),
			["2026-08-26T09:00:00Z", "2026-09-02T11:00:00Z"],
		);
	});

	it("reads an override's end in the override's own zone", async () => {
		// The moved instance was rewritten in a different zone from the series,
		// and its DTEND names a third. Resolving either with the master's TZID
		// puts this instance an hour out and changes how long it lasts.
		const expansion = await expand(
			ical(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				"BEGIN:VEVENT",
				"UID:crosszone@example.com",
				"DTSTART;TZID=Europe/Berlin:20260826T090000",
				"DTEND;TZID=Europe/Berlin:20260826T100000",
				"RRULE:FREQ=WEEKLY;COUNT=2",
				"END:VEVENT",
				"BEGIN:VEVENT",
				"UID:crosszone@example.com",
				"RECURRENCE-ID;TZID=Europe/Berlin:20260902T090000",
				"DTSTART;TZID=Europe/London:20260902T090000",
				"DTEND;TZID=Europe/Lisbon:20260902T103000",
				"END:VEVENT",
				"END:VCALENDAR",
			),
		);

		assert.deepEqual(
			expansion.occurrences.map((occurrence) => [
				occurrence.recurrenceId,
				occurrence.startAt,
				occurrence.endAt,
			]),
			[
				[
					"2026-08-26T07:00:00Z",
					"2026-08-26T07:00:00Z",
					"2026-08-26T08:00:00Z",
				],
				[
					"2026-09-02T07:00:00Z",
					"2026-09-02T08:00:00Z",
					"2026-09-02T09:30:00Z",
				],
			],
		);
	});

	it("expands an all-day series as whole days", async () => {
		const expansion = await expand(
			singleEvent(
				"DTSTART;VALUE=DATE:20260826",
				"DTEND;VALUE=DATE:20260827",
				"RRULE:FREQ=DAILY;COUNT=2",
			),
			"Europe/Berlin",
		);

		assert.deepEqual(expansion.occurrences, [
			{
				recurrenceId: "2026-08-25T22:00:00Z",
				startAt: "2026-08-25T22:00:00Z",
				endAt: "2026-08-26T22:00:00Z",
				allDay: true,
				summary: "",
				status: CalendarEventStatus.Confirmed,
				transparency: CalendarTransparency.Opaque,
			},
			{
				recurrenceId: "2026-08-26T22:00:00Z",
				startAt: "2026-08-26T22:00:00Z",
				endAt: "2026-08-27T22:00:00Z",
				allDay: true,
				summary: "",
				status: CalendarEventStatus.Confirmed,
				transparency: CalendarTransparency.Opaque,
			},
		]);
	});

	it("stops an open-ended series at the horizon and says how far it got", async () => {
		const expansion = await expand(
			singleEvent(
				"DTSTART:20260101T090000Z",
				"DTEND:20260101T100000Z",
				"RRULE:FREQ=DAILY",
			),
		);

		assert.notEqual(expansion.expandedThrough, "");
		const last = expansion.occurrences[expansion.occurrences.length - 1];
		assert.equal(expansion.expandedThrough, last?.startAt);
		assert.ok(
			Date.parse(expansion.expandedThrough) -
				Date.parse("2026-01-01T09:00:00Z") <=
				CALENDAR_EXPANSION_HORIZON_DAYS * 24 * 60 * 60 * 1000,
			"the last written occurrence is inside the horizon",
		);
	});

	it("stops a dense series at the occurrence ceiling", async () => {
		const expansion = await expand(
			singleEvent(
				"DTSTART:20260101T090000Z",
				"DTEND:20260101T090100Z",
				"RRULE:FREQ=MINUTELY",
			),
		);

		assert.equal(
			expansion.occurrences.length,
			CALENDAR_EXPANSION_MAX_OCCURRENCES,
		);
		assert.notEqual(expansion.expandedThrough, "");
	});

	it("marks a series whose first occurrence falls past the horizon", async () => {
		// The rule's own first instance is excluded, so the iterator's first slot
		// is 2029 and the horizon closes in 2027. Nothing is written, but the
		// series is not complete: `""` here would hide it from the live expansion
		// and the event would render nowhere, ever.
		const expansion = await expand(
			singleEvent(
				"DTSTART:20250301T090000Z",
				"DTEND:20250301T100000Z",
				"RRULE:FREQ=YEARLY;INTERVAL=4",
				"EXDATE:20250301T090000Z",
			),
		);

		assert.deepEqual(expansion.occurrences, []);
		assert.equal(expansion.expandedThrough, "2025-03-01T09:00:00Z");
	});

	it("says nothing about a horizon for a series that ends inside it", async () => {
		const expansion = await expand(
			singleEvent(
				"DTSTART:20260101T090000Z",
				"DTEND:20260101T100000Z",
				"RRULE:FREQ=WEEKLY;UNTIL=20260301T090000Z",
			),
		);

		assert.equal(expansion.expandedThrough, "");
		assert.equal(expansion.occurrences.length, 9);
	});
});
