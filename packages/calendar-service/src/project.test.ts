import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AMSTERDAM_VTIMEZONE, ical, singleEvent } from "./fixtures.js";
import { parseCalendar } from "./parse.js";
import { projectCalendar } from "./project.js";

const project = async (icalData: string, timezone = "") => {
	const parsed = await parseCalendar(icalData);
	assert.ok(parsed.ok, `expected a parse, got ${JSON.stringify(parsed)}`);
	return projectCalendar(parsed.value, timezone);
};

const projection = async (icalData: string, timezone = "") => {
	const result = await project(icalData, timezone);
	assert.ok(result.ok, `expected a projection, got ${JSON.stringify(result)}`);
	return result.value;
};

describe("projectCalendar", () => {
	it("projects the columns a UTC event carries", async () => {
		const value = await projection(
			singleEvent(
				"DTSTART:20260826T090000Z",
				"DTEND:20260826T100000Z",
				"SUMMARY:Quarterly review",
				"STATUS:TENTATIVE",
				"TRANSP:TRANSPARENT",
				"SEQUENCE:3",
			),
		);

		assert.deepEqual(value, {
			icalUid: "fixture@example.com",
			summary: "Quarterly review",
			dtStart: "2026-08-26T09:00:00+00:00",
			dtEnd: "2026-08-26T10:00:00+00:00",
			allDay: false,
			zoneCertainty: "Explicit",
			status: "Tentative",
			transparency: "Transparent",
			hasRecurrence: false,
			sequence: 3,
		});
	});

	it("gives an event that states neither the RFC's defaults", async () => {
		const value = await projection(
			singleEvent("DTSTART:20260826T090000Z", "DTEND:20260826T100000Z"),
		);

		assert.equal(value.status, "Confirmed");
		assert.equal(value.transparency, "Opaque");
		assert.equal(value.summary, "");
		assert.equal(value.sequence, 0);
	});

	it("keeps the event's own offset, resolved from the VTIMEZONE it carries", async () => {
		const value = await projection(
			ical(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				...AMSTERDAM_VTIMEZONE,
				"BEGIN:VEVENT",
				"UID:fixture@example.com",
				"DTSTART;TZID=Europe/Amsterdam:20260826T090000",
				"DTEND;TZID=Europe/Amsterdam:20260826T100000",
				"END:VEVENT",
				"END:VCALENDAR",
			),
		);

		assert.equal(value.dtStart, "2026-08-26T09:00:00+02:00");
		assert.equal(value.dtEnd, "2026-08-26T10:00:00+02:00");
	});

	it("resolves a TZID the resource carries no VTIMEZONE for", async () => {
		const value = await projection(
			singleEvent(
				"DTSTART;TZID=Europe/Berlin:20260826T090000",
				"DTEND;TZID=Europe/Berlin:20260826T100000",
			),
		);

		assert.equal(value.dtStart, "2026-08-26T09:00:00+02:00");
	});

	it("reads a floating time in the collection's timezone", async () => {
		const value = await projection(
			singleEvent("DTSTART:20260826T090000", "DTEND:20260826T100000"),
			"Europe/Berlin",
		);

		assert.equal(value.dtStart, "2026-08-26T09:00:00+02:00");
	});

	it("marks a zone nothing could resolve as ambiguous rather than reading it as UTC in silence", async () => {
		// A Windows zone name with no VTIMEZONE. The event still gets an instant —
		// there is nothing else to give it — but a two-hour error that presents as
		// a fact is the failure this marker exists to prevent.
		const value = await projection(
			singleEvent(
				"DTSTART;TZID=W. Europe Standard Time:20260826T090000",
				"DTEND;TZID=W. Europe Standard Time:20260826T100000",
			),
		);

		assert.equal(value.dtStart, "2026-08-26T09:00:00+00:00");
		assert.equal(value.zoneCertainty, "Ambiguous");
	});

	it("marks a floating time as local to the collection", async () => {
		const value = await projection(
			singleEvent("DTSTART:20260826T090000", "DTEND:20260826T100000"),
			"Europe/Berlin",
		);

		assert.equal(value.zoneCertainty, "Local");
	});

	it("marks a zone that resolved as explicit, however it resolved", async () => {
		const fromVtimezone = await projection(
			ical(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				...AMSTERDAM_VTIMEZONE,
				"BEGIN:VEVENT",
				"UID:fixture@example.com",
				"DTSTART;TZID=Europe/Amsterdam:20260826T090000",
				"DTEND;TZID=Europe/Amsterdam:20260826T100000",
				"END:VEVENT",
				"END:VCALENDAR",
			),
		);
		const fromPlatform = await projection(
			singleEvent(
				"DTSTART;TZID=Europe/Berlin:20260826T090000",
				"DTEND;TZID=Europe/Berlin:20260826T100000",
			),
		);
		const fromUtc = await projection(
			singleEvent("DTSTART:20260826T090000Z", "DTEND:20260826T100000Z"),
		);

		assert.equal(fromVtimezone.zoneCertainty, "Explicit");
		assert.equal(fromPlatform.zoneCertainty, "Explicit");
		assert.equal(fromUtc.zoneCertainty, "Explicit");
	});

	it("projects an all-day event as midnight with an exclusive end", async () => {
		const value = await projection(
			singleEvent("DTSTART;VALUE=DATE:20260826", "DTEND;VALUE=DATE:20260828"),
			"Europe/Berlin",
		);

		assert.equal(value.allDay, true);
		assert.equal(value.dtStart, "2026-08-26T00:00:00+02:00");
		assert.equal(value.dtEnd, "2026-08-28T00:00:00+02:00");
	});

	it("ends a one-day all-day event on the following day, per RFC 5545", async () => {
		const value = await projection(
			singleEvent("DTSTART;VALUE=DATE:20260826"),
			"Europe/Berlin",
		);

		assert.equal(value.dtEnd, "2026-08-27T00:00:00+02:00");
	});

	it("resolves an end stated as a DURATION", async () => {
		const value = await projection(
			singleEvent("DTSTART:20260826T090000Z", "DURATION:PT90M"),
		);

		assert.equal(value.dtEnd, "2026-08-26T10:30:00+00:00");
	});

	it("marks an event that recurs", async () => {
		const withRrule = await projection(
			singleEvent("DTSTART:20260826T090000Z", "RRULE:FREQ=WEEKLY;COUNT=3"),
		);
		const withRdate = await projection(
			singleEvent("DTSTART:20260826T090000Z", "RDATE:20260902T090000Z"),
		);
		const withOnlyOverrides = await projection(
			ical(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				"BEGIN:VEVENT",
				"UID:fixture@example.com",
				"DTSTART:20260826T090000Z",
				"DTEND:20260826T100000Z",
				"END:VEVENT",
				"BEGIN:VEVENT",
				"UID:fixture@example.com",
				"RECURRENCE-ID:20260902T090000Z",
				"DTSTART:20260902T110000Z",
				"DTEND:20260902T120000Z",
				"END:VEVENT",
				"END:VCALENDAR",
			),
		);

		assert.equal(withRrule.hasRecurrence, true);
		assert.equal(withRdate.hasRecurrence, true);
		assert.equal(withOnlyOverrides.hasRecurrence, true);
	});

	it("refuses an event that ends before it starts, naming both times", async () => {
		const result = await project(
			singleEvent("DTSTART:20260826T100000Z", "DTEND:20260826T090000Z"),
		);

		assert.ok(!result.ok);
		assert.equal(result.error.code, "BackwardsEnd");
		assert.match(result.error.message, /2026-08-26T09:00:00Z/);
		assert.match(result.error.message, /2026-08-26T10:00:00Z/);
	});

	it("refuses an event whose end precedes its start only once zones are applied", async () => {
		// 09:30 in Amsterdam is 07:30Z, half an hour before the 08:00Z start — a
		// comparison of the wall-clock strings would have called this fine.
		const result = await project(
			ical(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				...AMSTERDAM_VTIMEZONE,
				"BEGIN:VEVENT",
				"UID:fixture@example.com",
				"DTSTART:20260826T080000Z",
				"DTEND;TZID=Europe/Amsterdam:20260826T093000",
				"END:VEVENT",
				"END:VCALENDAR",
			),
		);

		assert.ok(!result.ok);
		assert.equal(result.error.code, "BackwardsEnd");
	});

	it("accepts a zero-length event", async () => {
		const value = await projection(
			singleEvent("DTSTART:20260826T090000Z", "DTEND:20260826T090000Z"),
		);

		assert.equal(value.dtEnd, "2026-08-26T09:00:00+00:00");
	});
});
