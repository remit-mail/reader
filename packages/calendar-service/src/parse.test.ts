import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asLf, ical, singleEvent } from "./fixtures.js";
import { parseCalendar, serializeCalendar } from "./parse.js";

const parsed = async (icalData: string) => {
	const result = await parseCalendar(icalData);
	assert.ok(result.ok, `expected a parse, got ${JSON.stringify(result)}`);
	return result.value;
};

const refusalCode = async (icalData: string) => {
	const result = await parseCalendar(icalData);
	assert.ok(!result.ok, "expected a refusal");
	return result.error;
};

describe("parseCalendar", () => {
	it("reads the master event and its UID", async () => {
		const calendar = await parsed(
			singleEvent("DTSTART:20260826T090000Z", "DTEND:20260826T100000Z"),
		);

		assert.equal(calendar.uid, "fixture@example.com");
		assert.equal(calendar.master.name, "vevent");
		assert.deepEqual(calendar.overrides, []);
	});

	it("separates the overrides from the master", async () => {
		const calendar = await parsed(
			ical(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				"BEGIN:VEVENT",
				"UID:series@example.com",
				"DTSTART:20260826T090000Z",
				"RRULE:FREQ=WEEKLY;COUNT=3",
				"END:VEVENT",
				"BEGIN:VEVENT",
				"UID:series@example.com",
				"RECURRENCE-ID:20260902T090000Z",
				"DTSTART:20260902T110000Z",
				"END:VEVENT",
				"END:VCALENDAR",
			),
		);

		assert.equal(calendar.overrides.length, 1);
		assert.ok(!calendar.master.hasProperty("recurrence-id"));
	});

	it("refuses bytes that are not iCalendar", async () => {
		assert.equal(
			(await refusalCode("this is not a calendar")).code,
			"MalformedIcalendar",
		);
	});

	it("refuses a document whose root is not a VCALENDAR", async () => {
		assert.equal(
			(
				await refusalCode(
					ical("BEGIN:VCARD", "VERSION:4.0", "FN:Someone", "END:VCARD"),
				)
			).code,
			"NotACalendar",
		);
	});

	it("refuses a component this collection does not store, naming it", async () => {
		const error = await refusalCode(
			ical(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				"BEGIN:VTODO",
				"UID:todo@example.com",
				"SUMMARY:Buy milk",
				"END:VTODO",
				"END:VCALENDAR",
			),
		);

		assert.equal(error.code, "UnsupportedComponent");
		assert.match(error.message, /VTODO/);
	});

	it("refuses a VCALENDAR with no VEVENT", async () => {
		assert.equal(
			(
				await refusalCode(
					ical("BEGIN:VCALENDAR", "VERSION:2.0", "END:VCALENDAR"),
				)
			).code,
			"NoEvent",
		);
	});

	it("refuses overrides with no event to override", async () => {
		const error = await refusalCode(
			ical(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				"BEGIN:VEVENT",
				"UID:orphan@example.com",
				"RECURRENCE-ID:20260902T090000Z",
				"DTSTART:20260902T110000Z",
				"END:VEVENT",
				"END:VCALENDAR",
			),
		);

		assert.equal(error.code, "NoMasterEvent");
	});

	it("refuses two unrelated events in one resource", async () => {
		const error = await refusalCode(
			ical(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				"BEGIN:VEVENT",
				"UID:one@example.com",
				"DTSTART:20260826T090000Z",
				"END:VEVENT",
				"BEGIN:VEVENT",
				"UID:two@example.com",
				"DTSTART:20260827T090000Z",
				"END:VEVENT",
				"END:VCALENDAR",
			),
		);

		assert.equal(error.code, "MultipleMasterEvents");
	});

	it("refuses a VEVENT with no UID", async () => {
		const error = await refusalCode(
			ical(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				"BEGIN:VEVENT",
				"DTSTART:20260826T090000Z",
				"END:VEVENT",
				"END:VCALENDAR",
			),
		);

		assert.equal(error.code, "MissingUid");
	});

	it("refuses an override that belongs to a different event", async () => {
		const error = await refusalCode(
			ical(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				"BEGIN:VEVENT",
				"UID:series@example.com",
				"DTSTART:20260826T090000Z",
				"RRULE:FREQ=WEEKLY;COUNT=3",
				"END:VEVENT",
				"BEGIN:VEVENT",
				"UID:stranger@example.com",
				"RECURRENCE-ID:20260902T090000Z",
				"DTSTART:20260902T110000Z",
				"END:VEVENT",
				"END:VCALENDAR",
			),
		);

		assert.equal(error.code, "MismatchedUid");
	});

	it("refuses a VEVENT with no DTSTART", async () => {
		assert.equal(
			(await refusalCode(singleEvent("SUMMARY:Undated"))).code,
			"MissingDtStart",
		);
	});
});

describe("serializeCalendar", () => {
	it("keeps the line endings RFC 5545 requires", async () => {
		const source = singleEvent(
			"DTSTART:20260826T090000Z",
			"DTEND:20260826T100000Z",
		);

		const serialized = serializeCalendar((await parsed(source)).component);

		assert.ok(serialized.includes("\r\n"));
		assert.doesNotMatch(
			serialized,
			/(?<!\r)\n/,
			"every line break is a CRLF, with no bare LF left behind",
		);
	});

	it("reads an LF-only resource and writes it back as CRLF", async () => {
		// RFC 5545 says CRLF; real files arrive both ways, and a parser that only
		// recognises CRLF reads an LF-only resource as one enormous line.
		const source = asLf(
			singleEvent("DTSTART:20260826T090000Z", "DTEND:20260826T100000Z"),
		);
		assert.ok(!source.includes("\r"), "the fixture is LF-only");

		const calendar = await parsed(source);
		const serialized = serializeCalendar(calendar.component);

		assert.equal(calendar.uid, "fixture@example.com");
		assert.ok(calendar.master.hasProperty("dtstart"));
		assert.doesNotMatch(serialized, /(?<!\r)\n/);
	});

	it("round-trips a resource losslessly, unknown properties included", async () => {
		const source = singleEvent(
			"DTSTART:20260826T090000Z",
			"DTEND:20260826T100000Z",
			"SUMMARY:Quarterly review",
			"X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC",
			"X-MICROSOFT-CDO-BUSYSTATUS:BUSY",
			"ATTENDEE;CN=Someone;X-NUM-GUESTS=0:mailto:someone@example.com",
		);

		const once = serializeCalendar((await parsed(source)).component);
		const twice = serializeCalendar((await parsed(once)).component);

		assert.equal(twice, once);
		for (const line of [
			"X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC",
			"X-MICROSOFT-CDO-BUSYSTATUS:BUSY",
			"X-NUM-GUESTS=0",
			"SUMMARY:Quarterly review",
		]) {
			assert.ok(once.includes(line), `${line} did not survive the round trip`);
		}
	});

	it("keeps a whole unknown subcomponent of the event", async () => {
		const source = singleEvent(
			"DTSTART:20260826T090000Z",
			"DTEND:20260826T100000Z",
			"BEGIN:VALARM",
			"ACTION:DISPLAY",
			"DESCRIPTION:Reminder",
			"TRIGGER:-PT15M",
			"END:VALARM",
		);

		const serialized = serializeCalendar((await parsed(source)).component);

		assert.ok(serialized.includes("BEGIN:VALARM"));
		assert.ok(serialized.includes("TRIGGER:-PT15M"));
	});
});
