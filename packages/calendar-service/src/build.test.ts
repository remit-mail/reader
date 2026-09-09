import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CalendarEventStatus, CalendarTransparency } from "@remit/domain-enums";
import { buildEventCalendar, type CalendarEventFields } from "./build.js";
import { expandCalendar } from "./expand.js";
import { parseCalendar } from "./parse.js";

const fields = (
	overrides: Partial<CalendarEventFields> = {},
): CalendarEventFields => ({
	summary: "Stand-up",
	description: "",
	location: "",
	start: "2026-10-15T09:00:00+02:00",
	end: "2026-10-15T10:00:00+02:00",
	allDay: false,
	timeZone: "",
	status: CalendarEventStatus.Confirmed,
	transparency: CalendarTransparency.Opaque,
	recurrenceRule: "",
	...overrides,
});

const build = async (overrides: Partial<CalendarEventFields> = {}) =>
	buildEventCalendar(
		fields(overrides),
		"new@reader.remit",
		new Date("2026-08-29T00:00:00Z"),
	);

describe("buildEventCalendar", () => {
	it("writes an event with no zone as the instant it names", async () => {
		const built = await build();

		assert.ok(built.ok, JSON.stringify(built));
		assert.ok(built.value.includes("DTSTART:20261015T070000Z"));
		assert.ok(built.value.includes("DTEND:20261015T080000Z"));
		assert.ok(built.value.includes("UID:new@reader.remit"));
		assert.ok(built.value.includes("SUMMARY:Stand-up"));
		assert.equal(
			built.value.includes("DESCRIPTION"),
			false,
			"an empty field is left out rather than written blank",
		);
	});

	it("anchors an event in the zone it names, not in the offset it arrived with", async () => {
		const built = await build({ timeZone: "Europe/Amsterdam" });

		assert.ok(built.ok);
		assert.ok(
			built.value.includes("DTSTART;TZID=Europe/Amsterdam:20261015T090000"),
		);
		assert.ok(
			built.value.includes("DTEND;TZID=Europe/Amsterdam:20261015T100000"),
		);
	});

	it("keeps a series at its local hour across a DST transition", async () => {
		const built = await build({
			timeZone: "Europe/Amsterdam",
			recurrenceRule: "FREQ=WEEKLY;COUNT=4",
		});
		assert.ok(built.ok);

		const parsed = await parseCalendar(built.value);
		assert.ok(parsed.ok);
		const expansion = expandCalendar(parsed.value, "Europe/Amsterdam");

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

	it("writes an all-day event as civil dates with an exclusive end", async () => {
		const built = await build({
			allDay: true,
			start: "2026-10-15",
			end: "2026-10-17",
		});

		assert.ok(built.ok);
		assert.ok(built.value.includes("DTSTART;VALUE=DATE:20261015"));
		assert.ok(built.value.includes("DTEND;VALUE=DATE:20261017"));
	});

	it("refuses a date-time with no zone offset", async () => {
		const built = await build({ start: "2026-10-15T09:00:00" });

		assert.ok(!built.ok);
		assert.equal(built.error.code, "InvalidDateTime");
	});

	it("refuses a zone this server cannot resolve", async () => {
		const built = await build({ timeZone: "W. Europe Standard Time" });

		assert.ok(!built.ok);
		assert.equal(built.error.code, "UnknownTimeZone");
	});

	it("refuses a recurrence rule it cannot read", async () => {
		const built = await build({ recurrenceRule: "EVERY OTHER TUESDAY" });

		assert.ok(!built.ok);
		assert.equal(built.error.code, "InvalidRecurrenceRule");
	});
});
