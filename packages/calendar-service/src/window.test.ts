import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	CalendarCollectionItem,
	CalendarEventIndexItem,
	CalendarObjectItem,
} from "@remit/data-ports";
import { deriveCalendarObjectId } from "@remit/data-ports/id";
import {
	CalendarColor,
	CalendarComponentSet,
	CalendarSource,
} from "@remit/domain-enums";
import { computeEtag } from "./etag.js";
import { expandCalendar } from "./expand.js";
import { AMSTERDAM_VTIMEZONE, ical, singleEvent } from "./fixtures.js";
import { parseCalendar } from "./parse.js";
import { projectCalendar } from "./project.js";
import {
	type CalendarWindowRepositories,
	listBusySpans,
	listCalendarInstances,
	mergeBusySpans,
} from "./window.js";

const collection = (
	overrides: Partial<CalendarCollectionItem> = {},
): CalendarCollectionItem => ({
	calendarId: "cal-1",
	accountConfigId: "acc-1",
	urlSegment: "default",
	displayName: "Calendar",
	color: CalendarColor.Cal1,
	componentSet: CalendarComponentSet.VeventOnly,
	source: CalendarSource.Default,
	timezone: "",
	syncSequence: 1,
	createdAt: 0,
	updatedAt: 0,
	...overrides,
});

interface StoredResource {
	object: CalendarObjectItem;
	rows: CalendarEventIndexItem[];
}

/**
 * A resource as the write path would have stored it — the projected columns and
 * the occurrence rows both computed from the bytes, so a read test can never
 * pass against a row the writer would not have produced.
 */
const store = async (
	calendar: CalendarCollectionItem,
	resourceName: string,
	icalData: string,
): Promise<StoredResource> => {
	const parsed = await parseCalendar(icalData);
	assert.ok(parsed.ok, `expected a parse, got ${JSON.stringify(parsed)}`);
	const projection = projectCalendar(parsed.value, calendar.timezone);
	assert.ok(projection.ok);
	const expansion = expandCalendar(parsed.value, calendar.timezone);
	const calendarObjectId = deriveCalendarObjectId(
		calendar.calendarId,
		resourceName,
	);

	return {
		object: {
			...projection.value,
			calendarObjectId,
			calendarId: calendar.calendarId,
			resourceName,
			icalData,
			etag: computeEtag(icalData),
			syncSequence: 1,
			expandedThrough: expansion.expandedThrough,
			createdAt: 0,
			updatedAt: 0,
		},
		rows: expansion.occurrences.map((occurrence) => ({
			...occurrence,
			calendarId: calendar.calendarId,
			calendarObjectId,
			createdAt: 0,
			updatedAt: 0,
		})),
	};
};

const repositories = (
	resources: StoredResource[],
): CalendarWindowRepositories => ({
	calendarObject: {
		find: async (calendarId, calendarObjectId) =>
			resources
				.map((resource) => resource.object)
				.find(
					(object) =>
						object.calendarId === calendarId &&
						object.calendarObjectId === calendarObjectId,
				) ?? null,
		listIncompleteExpansions: async (calendarId, instant) =>
			resources
				.map((resource) => resource.object)
				.filter(
					(object) =>
						object.calendarId === calendarId &&
						object.expandedThrough !== "" &&
						object.expandedThrough < instant,
				),
	},
	calendarEventIndex: {
		listByStartRange: async (calendarId, startAt, endAt) =>
			resources
				.flatMap((resource) => resource.rows)
				.filter(
					(row) =>
						row.calendarId === calendarId &&
						row.startAt >= startAt &&
						row.startAt < endAt,
				)
				.sort((left, right) => left.startAt.localeCompare(right.startAt)),
	},
});

describe("listCalendarInstances", () => {
	it("returns the occurrences that start in the window and nothing after it", async () => {
		const calendar = collection();
		const weekly = await store(
			calendar,
			"weekly.ics",
			ical(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				"BEGIN:VEVENT",
				"UID:weekly@example.com",
				"DTSTART:20260907T090000Z",
				"DTEND:20260907T100000Z",
				"SUMMARY:Stand-up",
				"RRULE:FREQ=WEEKLY;COUNT=5",
				"END:VEVENT",
				"END:VCALENDAR",
			),
		);

		const instances = await listCalendarInstances(
			repositories([weekly]),
			[calendar],
			{ from: "2026-09-14T00:00:00Z", to: "2026-09-28T00:00:00Z" },
		);

		assert.deepEqual(
			instances.map((instance) => instance.startAt),
			["2026-09-14T09:00:00Z", "2026-09-21T09:00:00Z"],
		);
		assert.equal(instances[0]?.summary, "Stand-up");
		assert.equal(instances[0]?.etag, weekly.object.etag);
		assert.equal(instances[0]?.hasRecurrence, true);
	});

	it("keeps an occurrence that began before the window and runs into it", async () => {
		const calendar = collection();
		const overnight = await store(
			calendar,
			"overnight.ics",
			singleEvent(
				"DTSTART:20260913T230000Z",
				"DTEND:20260914T010000Z",
				"SUMMARY:Deploy window",
			),
		);

		const instances = await listCalendarInstances(
			repositories([overnight]),
			[calendar],
			{ from: "2026-09-14T00:00:00Z", to: "2026-09-15T00:00:00Z" },
		);

		assert.deepEqual(
			instances.map((instance) => instance.summary),
			["Deploy window"],
		);
	});

	it("leaves out an event that ended before the window opened", async () => {
		const calendar = collection();
		const earlier = await store(
			calendar,
			"earlier.ics",
			singleEvent("DTSTART:20260913T090000Z", "DTEND:20260913T100000Z"),
		);

		const instances = await listCalendarInstances(
			repositories([earlier]),
			[calendar],
			{ from: "2026-09-14T00:00:00Z", to: "2026-09-15T00:00:00Z" },
		);

		assert.deepEqual(instances, []);
	});

	it("expands a series live when the stored index stops before the window", async () => {
		const calendar = collection();
		// Open-ended and old: the horizon anchors at the series' own start, so the
		// index runs out two years in and today is nowhere in it.
		const openEnded = await store(
			calendar,
			"open.ics",
			ical(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				"BEGIN:VEVENT",
				"UID:open@example.com",
				"DTSTART:20200907T090000Z",
				"DTEND:20200907T100000Z",
				"SUMMARY:Weekly one-to-one",
				"RRULE:FREQ=WEEKLY",
				"END:VEVENT",
				"END:VCALENDAR",
			),
		);

		assert.notEqual(
			openEnded.object.expandedThrough,
			"",
			"the fixture only tests anything if the index really is incomplete",
		);
		assert.equal(
			openEnded.rows.some((row) => row.startAt >= "2026-09-14T00:00:00Z"),
			false,
			"and the index really does stop before the window",
		);

		const instances = await listCalendarInstances(
			repositories([openEnded]),
			[calendar],
			{ from: "2026-09-14T00:00:00Z", to: "2026-09-28T00:00:00Z" },
		);

		assert.deepEqual(
			instances.map((instance) => instance.startAt),
			["2026-09-14T09:00:00Z", "2026-09-21T09:00:00Z"],
		);
		assert.equal(instances[0]?.summary, "Weekly one-to-one");
	});

	it("expands a series whose index is empty because its first occurrence is past the horizon", async () => {
		const calendar = collection();
		// The rule's own first instance is excluded, so the first occurrence is in
		// 2029 and the horizon closed in 2027. The index holds no row at all, and
		// the only thing that can serve the event is the live expansion.
		const distant = await store(
			calendar,
			"distant.ics",
			ical(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				"BEGIN:VEVENT",
				"UID:distant@example.com",
				"DTSTART:20250301T090000Z",
				"DTEND:20250301T100000Z",
				"SUMMARY:Leap day review",
				"RRULE:FREQ=YEARLY;INTERVAL=4",
				"EXDATE:20250301T090000Z",
				"END:VEVENT",
				"END:VCALENDAR",
			),
		);

		assert.deepEqual(distant.rows, [], "the index really is empty");
		assert.deepEqual(
			await repositories([distant]).calendarObject.listIncompleteExpansions(
				calendar.calendarId,
				"2029-04-01T00:00:00Z",
			),
			[distant.object],
			"and the resource is still offered to the live expansion",
		);

		const instances = await listCalendarInstances(
			repositories([distant]),
			[calendar],
			{ from: "2029-03-01T00:00:00Z", to: "2029-04-01T00:00:00Z" },
		);

		assert.deepEqual(
			instances.map((instance) => instance.startAt),
			["2029-03-01T09:00:00Z"],
		);
		assert.equal(instances[0]?.summary, "Leap day review");
	});

	it("serves a live-expanded series from one source, never twice", async () => {
		const calendar = collection();
		const openEnded = await store(
			calendar,
			"open.ics",
			ical(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				"BEGIN:VEVENT",
				"UID:open@example.com",
				"DTSTART:20200907T090000Z",
				"DTEND:20200907T100000Z",
				"RRULE:FREQ=WEEKLY",
				"END:VEVENT",
				"END:VCALENDAR",
			),
		);

		// A window the index does cover, for a resource still marked incomplete.
		const instances = await listCalendarInstances(
			repositories([openEnded]),
			[calendar],
			{ from: "2020-09-14T00:00:00Z", to: "2020-09-28T00:00:00Z" },
		);

		assert.deepEqual(
			instances.map((instance) => instance.startAt),
			["2020-09-14T09:00:00Z", "2020-09-21T09:00:00Z"],
		);
	});

	it("keeps a series at its local hour across a DST transition", async () => {
		const calendar = collection({ timezone: "Europe/Amsterdam" });
		const amsterdam = await store(
			calendar,
			"amsterdam.ics",
			ical(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				...AMSTERDAM_VTIMEZONE,
				"BEGIN:VEVENT",
				"UID:amsterdam@example.com",
				"DTSTART;TZID=Europe/Amsterdam:20261015T090000",
				"DTEND;TZID=Europe/Amsterdam:20261015T100000",
				"SUMMARY:Stand-up",
				"RRULE:FREQ=WEEKLY;COUNT=4",
				"END:VEVENT",
				"END:VCALENDAR",
			),
		);

		const instances = await listCalendarInstances(
			repositories([amsterdam]),
			[calendar],
			{ from: "2026-10-01T00:00:00Z", to: "2026-11-30T00:00:00Z" },
		);

		assert.deepEqual(
			instances.map((instance) => instance.start),
			[
				"2026-10-15T09:00:00+02:00",
				"2026-10-22T09:00:00+02:00",
				"2026-10-29T09:00:00+01:00",
				"2026-11-05T09:00:00+01:00",
			],
		);
		assert.deepEqual(
			instances.map((instance) => instance.startAt),
			[
				"2026-10-15T07:00:00Z",
				"2026-10-22T07:00:00Z",
				"2026-10-29T08:00:00Z",
				"2026-11-05T08:00:00Z",
			],
		);
	});
});

describe("mergeBusySpans", () => {
	it("collapses overlapping and touching spans", () => {
		assert.deepEqual(
			mergeBusySpans([
				{ startMs: 30, endMs: 40 },
				{ startMs: 0, endMs: 10 },
				{ startMs: 5, endMs: 20 },
				{ startMs: 40, endMs: 50 },
			]),
			[
				{ startMs: 0, endMs: 20 },
				{ startMs: 30, endMs: 50 },
			],
		);
	});

	it("keeps a span that a longer one already covers out of the result", () => {
		assert.deepEqual(
			mergeBusySpans([
				{ startMs: 0, endMs: 100 },
				{ startMs: 20, endMs: 30 },
			]),
			[{ startMs: 0, endMs: 100 }],
		);
	});
});

describe("listBusySpans", () => {
	it("merges overlapping events across calendars into one stretch", async () => {
		const work = collection({ calendarId: "cal-work", urlSegment: "work" });
		const home = collection({ calendarId: "cal-home", urlSegment: "home" });
		const standup = await store(
			work,
			"standup.ics",
			singleEvent("DTSTART:20260914T090000Z", "DTEND:20260914T100000Z"),
		);
		const review = await store(
			home,
			"review.ics",
			singleEvent("DTSTART:20260914T093000Z", "DTEND:20260914T110000Z"),
		);

		const spans = await listBusySpans(
			repositories([standup, review]),
			[work, home],
			{ from: "2026-09-14T00:00:00Z", to: "2026-09-15T00:00:00Z" },
		);

		assert.deepEqual(spans, [
			{
				startMs: Date.parse("2026-09-14T09:00:00Z"),
				endMs: Date.parse("2026-09-14T11:00:00Z"),
			},
		]);
	});

	it("leaves out a transparent event and a cancelled one", async () => {
		const calendar = collection();
		const transparent = await store(
			calendar,
			"transparent.ics",
			singleEvent(
				"DTSTART:20260914T090000Z",
				"DTEND:20260914T100000Z",
				"TRANSP:TRANSPARENT",
			),
		);
		const cancelled = await store(
			calendar,
			"cancelled.ics",
			singleEvent(
				"DTSTART:20260914T110000Z",
				"DTEND:20260914T120000Z",
				"STATUS:CANCELLED",
			),
		);
		const busy = await store(
			calendar,
			"busy.ics",
			singleEvent("DTSTART:20260914T140000Z", "DTEND:20260914T150000Z"),
		);

		const spans = await listBusySpans(
			repositories([transparent, cancelled, busy]),
			[calendar],
			{ from: "2026-09-14T00:00:00Z", to: "2026-09-15T00:00:00Z" },
		);

		assert.deepEqual(spans, [
			{
				startMs: Date.parse("2026-09-14T14:00:00Z"),
				endMs: Date.parse("2026-09-14T15:00:00Z"),
			},
		]);
	});

	it("clips a span that runs past the window to the window", async () => {
		const calendar = collection();
		const overnight = await store(
			calendar,
			"overnight.ics",
			singleEvent("DTSTART:20260913T230000Z", "DTEND:20260914T010000Z"),
		);

		const spans = await listBusySpans(repositories([overnight]), [calendar], {
			from: "2026-09-14T00:00:00Z",
			to: "2026-09-15T00:00:00Z",
		});

		assert.deepEqual(spans, [
			{
				startMs: Date.parse("2026-09-14T00:00:00Z"),
				endMs: Date.parse("2026-09-14T01:00:00Z"),
			},
		]);
	});
});

describe("an occurrence a client edited on its own", () => {
	const withOverride = (...overrideLines: string[]) =>
		ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"BEGIN:VEVENT",
			"UID:weekly@example.com",
			"DTSTART:20260907T090000Z",
			"DTEND:20260907T100000Z",
			"SUMMARY:Stand-up",
			"RRULE:FREQ=WEEKLY;COUNT=3",
			"END:VEVENT",
			"BEGIN:VEVENT",
			"UID:weekly@example.com",
			"RECURRENCE-ID:20260914T090000Z",
			"DTSTART:20260914T090000Z",
			"DTEND:20260914T100000Z",
			...overrideLines,
			"END:VEVENT",
			"END:VCALENDAR",
		);

	const window = { from: "2026-09-01T00:00:00Z", to: "2026-09-30T00:00:00Z" };

	it("shows the override's summary, not the one the series carries", async () => {
		const calendar = collection();
		const stored = await store(
			calendar,
			"weekly.ics",
			withOverride("SUMMARY:Stand-up (with the client team)"),
		);

		const instances = await listCalendarInstances(
			repositories([stored]),
			[calendar],
			window,
		);

		assert.deepEqual(
			instances.map((instance) => instance.summary),
			["Stand-up", "Stand-up (with the client team)", "Stand-up"],
		);
	});

	it("stops counting one cancelled occurrence as busy time", async () => {
		const calendar = collection();
		const stored = await store(
			calendar,
			"weekly.ics",
			withOverride("SUMMARY:Stand-up", "STATUS:CANCELLED"),
		);

		const spans = await listBusySpans(
			repositories([stored]),
			[calendar],
			window,
		);

		assert.deepEqual(
			spans.map((span) => new Date(span.startMs).toISOString()),
			["2026-09-07T09:00:00.000Z", "2026-09-21T09:00:00.000Z"],
		);
	});

	it("stops counting one occurrence marked transparent as busy time", async () => {
		const calendar = collection();
		const stored = await store(
			calendar,
			"weekly.ics",
			withOverride("SUMMARY:Stand-up", "TRANSP:TRANSPARENT"),
		);

		const spans = await listBusySpans(
			repositories([stored]),
			[calendar],
			window,
		);

		assert.equal(spans.length, 2);
	});
});
