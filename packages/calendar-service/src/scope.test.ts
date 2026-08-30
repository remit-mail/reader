import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RecurrenceScope } from "@remit/domain-enums";
import { expandCalendar } from "./expand.js";
import { AMSTERDAM_VTIMEZONE, ical, singleEvent } from "./fixtures.js";
import { parseCalendar } from "./parse.js";
import { applyScopedDelete, applyScopedUpdate } from "./scope.js";

const WEEKLY = ical(
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
);

const OPEN_ENDED = ical(
	"BEGIN:VCALENDAR",
	"VERSION:2.0",
	"BEGIN:VEVENT",
	"UID:open@example.com",
	"DTSTART:20260907T090000Z",
	"DTEND:20260907T100000Z",
	"SUMMARY:Stand-up",
	"RRULE:FREQ=WEEKLY",
	"END:VEVENT",
	"END:VCALENDAR",
);

const AMSTERDAM_WEEKLY = ical(
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
);

const read = async (icalData: string) => {
	const parsed = await parseCalendar(icalData);
	assert.ok(parsed.ok, `expected a parse, got ${JSON.stringify(parsed)}`);
	return parsed.value;
};

const input = (
	scope: (typeof RecurrenceScope)[keyof typeof RecurrenceScope],
	recurrenceId = "",
) => ({ scope, recurrenceId, followingUid: "split@example.com" });

/** The VEVENT blocks of a resource, so an assertion can name one of them. */
const events = (icalData: string): string[][] => {
	const lines = icalData.split("\r\n");
	const blocks: string[][] = [];
	let current: string[] | null = null;
	for (const line of lines) {
		if (line === "BEGIN:VEVENT") {
			current = [];
			continue;
		}
		if (line === "END:VEVENT" && current) {
			blocks.push(current);
			current = null;
			continue;
		}
		current?.push(line);
	}
	return blocks;
};

describe("applyScopedUpdate", () => {
	it("rewrites the master and nothing else under scope=All", async () => {
		const calendar = await read(WEEKLY);

		const write = await applyScopedUpdate(
			calendar,
			"",
			input(RecurrenceScope.All),
			{ summary: "Stand-up (renamed)" },
		);

		assert.ok(write.ok);
		assert.equal(write.value.kind, "Replace");
		assert.ok(write.value.kind === "Replace");
		const [master, ...rest] = events(write.value.icalData);
		assert.deepEqual(rest, []);
		assert.ok(master?.includes("SUMMARY:Stand-up (renamed)"));
		assert.ok(master?.includes("RRULE:FREQ=WEEKLY;COUNT=5"));
		assert.ok(master?.includes("DTSTART:20260907T090000Z"));
	});

	it("writes a RECURRENCE-ID override for one occurrence under scope=This", async () => {
		const calendar = await read(WEEKLY);

		const write = await applyScopedUpdate(
			calendar,
			"",
			input(RecurrenceScope.This, "2026-09-21T09:00:00Z"),
			{ summary: "Stand-up (this week only)", start: "2026-09-21T10:00:00Z" },
		);

		assert.ok(write.ok);
		assert.ok(write.value.kind === "Replace");
		const [master, override] = events(write.value.icalData);
		assert.ok(master?.includes("SUMMARY:Stand-up"));
		assert.ok(
			master?.includes("RRULE:FREQ=WEEKLY;COUNT=5"),
			"the series keeps its own rule",
		);
		assert.ok(override?.includes("RECURRENCE-ID:20260921T090000Z"));
		assert.ok(override?.includes("SUMMARY:Stand-up (this week only)"));
		assert.ok(override?.includes("DTSTART:20260921T100000Z"));
		assert.equal(
			override?.some((line) => line.startsWith("RRULE")),
			false,
			"an override is one occurrence and carries no rule",
		);
	});

	it("edits the override a resource already carries rather than adding a second", async () => {
		const calendar = await read(
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
				"BEGIN:VEVENT",
				"UID:weekly@example.com",
				"RECURRENCE-ID:20260914T090000Z",
				"DTSTART:20260914T110000Z",
				"DTEND:20260914T120000Z",
				"SUMMARY:Stand-up (moved)",
				"END:VEVENT",
				"END:VCALENDAR",
			),
		);

		const write = await applyScopedUpdate(
			calendar,
			"",
			input(RecurrenceScope.This, "2026-09-14T09:00:00Z"),
			{ summary: "Stand-up (moved again)" },
		);

		assert.ok(write.ok);
		assert.ok(write.value.kind === "Replace");
		const blocks = events(write.value.icalData);
		assert.equal(blocks.length, 2);
		assert.ok(blocks[1]?.includes("SUMMARY:Stand-up (moved again)"));
		assert.ok(
			blocks[1]?.includes("DTSTART:20260914T110000Z"),
			"the instance keeps where it was moved to",
		);
	});

	it("splits a counted series into a truncated head and a remainder under scope=Following", async () => {
		const calendar = await read(WEEKLY);

		const write = await applyScopedUpdate(
			calendar,
			"",
			input(RecurrenceScope.Following, "2026-09-21T09:00:00Z"),
			{ summary: "Stand-up (new format)" },
		);

		assert.ok(write.ok);
		assert.equal(write.value.kind, "Split");
		assert.ok(write.value.kind === "Split");

		const [head] = events(write.value.icalData);
		assert.ok(
			head?.includes("RRULE:FREQ=WEEKLY;COUNT=2"),
			"the head keeps the two occurrences before the split",
		);
		assert.ok(head?.includes("SUMMARY:Stand-up"));
		assert.ok(head?.includes("DTSTART:20260907T090000Z"));

		const [tail] = events(write.value.following);
		assert.ok(tail?.includes("UID:split@example.com"));
		assert.ok(tail?.includes("DTSTART:20260921T090000Z"));
		assert.ok(tail?.includes("DTEND:20260921T100000Z"));
		assert.ok(tail?.includes("RRULE:FREQ=WEEKLY;COUNT=3"));
		assert.ok(tail?.includes("SUMMARY:Stand-up (new format)"));
	});

	it("ends an open series with UNTIL just before the split", async () => {
		const calendar = await read(OPEN_ENDED);

		const write = await applyScopedUpdate(
			calendar,
			"",
			input(RecurrenceScope.Following, "2026-09-21T09:00:00Z"),
			{ summary: "Stand-up (new format)" },
		);

		assert.ok(write.ok);
		assert.ok(write.value.kind === "Split");
		const [head] = events(write.value.icalData);
		assert.ok(head?.includes("RRULE:FREQ=WEEKLY;UNTIL=20260921T085959Z"));
		const [tail] = events(write.value.following);
		assert.ok(
			tail?.includes("RRULE:FREQ=WEEKLY"),
			"the remainder stays open-ended",
		);
	});

	it("keeps the anchoring zone when the split series is written with a TZID", async () => {
		const calendar = await read(AMSTERDAM_WEEKLY);

		const write = await applyScopedUpdate(
			calendar,
			"Europe/Amsterdam",
			// The fourth occurrence. The clocks went back on 25 October, so the
			// same 09:00 local is an hour earlier in UTC than the first three.
			input(RecurrenceScope.Following, "2026-11-05T08:00:00Z"),
			{ summary: "Stand-up (new format)" },
		);

		assert.ok(write.ok);
		assert.ok(write.value.kind === "Split");
		const [tail] = events(write.value.following);
		assert.ok(
			tail?.includes("DTSTART;TZID=Europe/Amsterdam:20261105T090000"),
			`the remainder is anchored in the zone, not the offset: ${tail?.join(" | ")}`,
		);
	});

	it("treats a split at the first occurrence as the whole series", async () => {
		const calendar = await read(WEEKLY);

		const write = await applyScopedUpdate(
			calendar,
			"",
			input(RecurrenceScope.Following, "2026-09-07T09:00:00Z"),
			{ summary: "Stand-up (renamed)" },
		);

		assert.ok(write.ok);
		assert.equal(write.value.kind, "Replace");
	});

	it("refuses a per-occurrence scope on an event that happens once", async () => {
		const calendar = await read(
			singleEvent("DTSTART:20260907T090000Z", "DTEND:20260907T100000Z"),
		);

		const write = await applyScopedUpdate(
			calendar,
			"",
			input(RecurrenceScope.This, "2026-09-07T09:00:00Z"),
			{ summary: "Renamed" },
		);

		assert.ok(!write.ok);
		assert.equal(write.error.code, "NotRecurring");
	});

	it("refuses a scope that names no occurrence", async () => {
		const calendar = await read(WEEKLY);

		const missing = await applyScopedUpdate(
			calendar,
			"",
			input(RecurrenceScope.This, ""),
			{},
		);
		assert.ok(!missing.ok);
		assert.equal(missing.error.code, "MissingRecurrenceId");

		const unknown = await applyScopedUpdate(
			calendar,
			"",
			input(RecurrenceScope.This, "2026-09-22T09:00:00Z"),
			{},
		);
		assert.ok(!unknown.ok);
		assert.equal(unknown.error.code, "UnknownOccurrence");
	});
});

describe("applyScopedDelete", () => {
	it("removes the resource under scope=All", async () => {
		const calendar = await read(WEEKLY);

		const write = await applyScopedDelete(
			calendar,
			"",
			input(RecurrenceScope.All),
		);

		assert.ok(write.ok);
		assert.equal(write.value.kind, "Delete");
	});

	it("writes an EXDATE for one occurrence under scope=This", async () => {
		const calendar = await read(WEEKLY);

		const write = await applyScopedDelete(
			calendar,
			"",
			input(RecurrenceScope.This, "2026-09-21T09:00:00Z"),
		);

		assert.ok(write.ok);
		assert.ok(write.value.kind === "Replace");
		const [master] = events(write.value.icalData);
		assert.ok(master?.includes("EXDATE:20260921T090000Z"));
		assert.ok(
			master?.includes("RRULE:FREQ=WEEKLY;COUNT=5"),
			"the rest of the series stays",
		);
	});

	it("drops the override an EXDATEd occurrence carried", async () => {
		const calendar = await read(
			ical(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				"BEGIN:VEVENT",
				"UID:weekly@example.com",
				"DTSTART:20260907T090000Z",
				"DTEND:20260907T100000Z",
				"RRULE:FREQ=WEEKLY;COUNT=5",
				"END:VEVENT",
				"BEGIN:VEVENT",
				"UID:weekly@example.com",
				"RECURRENCE-ID:20260914T090000Z",
				"DTSTART:20260914T110000Z",
				"DTEND:20260914T120000Z",
				"END:VEVENT",
				"END:VCALENDAR",
			),
		);

		const write = await applyScopedDelete(
			calendar,
			"",
			input(RecurrenceScope.This, "2026-09-14T09:00:00Z"),
		);

		assert.ok(write.ok);
		assert.ok(write.value.kind === "Replace");
		assert.equal(events(write.value.icalData).length, 1);
		assert.ok(
			events(write.value.icalData)[0]?.includes("EXDATE:20260914T090000Z"),
		);
	});

	it("truncates the series under scope=Following without removing it", async () => {
		const calendar = await read(WEEKLY);

		const write = await applyScopedDelete(
			calendar,
			"",
			input(RecurrenceScope.Following, "2026-09-21T09:00:00Z"),
		);

		assert.ok(write.ok);
		assert.ok(write.value.kind === "Replace");
		assert.ok(
			events(write.value.icalData)[0]?.includes("RRULE:FREQ=WEEKLY;COUNT=2"),
		);
	});

	it("removes the resource when the split would take the first occurrence", async () => {
		const calendar = await read(WEEKLY);

		const write = await applyScopedDelete(
			calendar,
			"",
			input(RecurrenceScope.Following, "2026-09-07T09:00:00Z"),
		);

		assert.ok(write.ok);
		assert.equal(write.value.kind, "Delete");
	});
});

describe("splitting a series whose DTSTART is not a UTC instant", () => {
	const openEnded = (...dtLines: string[]) =>
		ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"BEGIN:VEVENT",
			"UID:series@example.com",
			...dtLines,
			"SUMMARY:Series",
			"RRULE:FREQ=WEEKLY",
			"END:VEVENT",
			"END:VCALENDAR",
		);

	// A zone behind UTC is what exposes it: a UTC UNTIL derived from the split
	// instant lands after the raw value the expander compares it to, so the head
	// keeps the occurrence the tail already starts with.
	const BEHIND_UTC = "America/New_York";

	const splitAtSecondSlot = async (icalData: string) => {
		const before = expandCalendar(await read(icalData), BEHIND_UTC);
		const at = before.occurrences[1]?.startAt as string;
		const write = await applyScopedUpdate(
			await read(icalData),
			BEHIND_UTC,
			input(RecurrenceScope.Following, at),
			{ summary: "Series (changed)" },
		);
		assert.ok(write.ok, JSON.stringify(write));
		assert.ok(write.value.kind === "Split");
		return {
			at,
			head: expandCalendar(await read(write.value.icalData), BEHIND_UTC),
			tail: expandCalendar(await read(write.value.following), BEHIND_UTC),
			rule: write.value.icalData
				.split("\r\n")
				.find((line) => line.startsWith("RRULE")),
		};
	};

	for (const [frame, dtLines] of Object.entries({
		"an all-day series": [
			"DTSTART;VALUE=DATE:20260601",
			"DTEND;VALUE=DATE:20260602",
		],
		"a floating series": ["DTSTART:20260601T090000", "DTEND:20260601T100000"],
		"a series naming a zone the resource does not define": [
			"DTSTART;TZID=Europe/Amsterdam:20260601T090000",
			"DTEND;TZID=Europe/Amsterdam:20260601T100000",
		],
		"a UTC series": ["DTSTART:20260601T090000Z", "DTEND:20260601T100000Z"],
	})) {
		it(`leaves the split occurrence to the remainder for ${frame}`, async () => {
			const { at, head, tail } = await splitAtSecondSlot(openEnded(...dtLines));

			assert.equal(
				head.occurrences.some((occurrence) => occurrence.startAt === at),
				false,
				"the truncated head still produced the occurrence it was split at",
			);
			assert.equal(tail.occurrences[0]?.startAt, at);
		});
	}

	it("writes UNTIL as a date for an all-day series, as RFC 5545 3.3.10 requires", async () => {
		const { rule } = await splitAtSecondSlot(
			openEnded("DTSTART;VALUE=DATE:20260601", "DTEND;VALUE=DATE:20260602"),
		);

		assert.equal(rule, "RRULE:FREQ=WEEKLY;UNTIL=20260607");
	});

	it("writes UNTIL in UTC for a series that names an instant", async () => {
		const { rule } = await splitAtSecondSlot(
			openEnded("DTSTART:20260601T090000Z", "DTEND:20260601T100000Z"),
		);

		assert.equal(rule, "RRULE:FREQ=WEEKLY;UNTIL=20260608T085959Z");
	});
});
