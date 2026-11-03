import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandCalendar } from "./expand.js";
import { parseCalendar } from "./parse.js";
import {
	attendeesOf,
	countAttendees,
	participationAtSlot,
	participationOf,
	selfAddressSet,
} from "./participation.js";

const SELF = selfAddressSet(["Me@Example.com"]);

const calendar = (...lines: string[]): string =>
	[
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//test//EN",
		...lines,
		"END:VCALENDAR",
	].join("\r\n");

const event = (...lines: string[]): string[] => [
	"BEGIN:VEVENT",
	"UID:series@test",
	"DTSTAMP:20260901T000000Z",
	...lines,
	"END:VEVENT",
];

const read = async (icalData: string) => {
	const parsed = await parseCalendar(icalData);
	assert.ok(parsed.ok, JSON.stringify(parsed));
	return parsed.value;
};

describe("participationOf", () => {
	it("reads an event nobody is invited to as unscheduled", async () => {
		const parsed = await read(
			calendar(...event("DTSTART:20260907T090000Z", "DTEND:20260907T100000Z")),
		);
		assert.equal(participationOf(parsed.master, SELF), "Unscheduled");
	});

	it("reads the reader as organizer when they organize it", async () => {
		const parsed = await read(
			calendar(
				...event(
					"DTSTART:20260907T090000Z",
					"ORGANIZER:mailto:me@example.com",
					"ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:guest@example.com",
				),
			),
		);
		assert.equal(participationOf(parsed.master, SELF), "Organizer");
	});

	it("reads the reader's own PARTSTAT, and a missing one as owed", async () => {
		for (const [line, expected] of [
			["ATTENDEE;PARTSTAT=ACCEPTED:mailto:me@example.com", "Accepted"],
			["ATTENDEE;PARTSTAT=DECLINED:MAILTO:ME@EXAMPLE.COM", "Declined"],
			["ATTENDEE;PARTSTAT=TENTATIVE:mailto:me@example.com", "Tentative"],
			["ATTENDEE:mailto:me@example.com", "NeedsAction"],
		] as const) {
			const parsed = await read(
				calendar(
					...event(
						"DTSTART:20260907T090000Z",
						"ORGANIZER:mailto:boss@example.com",
						line,
					),
				),
			);
			assert.equal(participationOf(parsed.master, SELF), expected, line);
		}
	});

	it("reads an event that lists others but not the reader as unscheduled", async () => {
		const parsed = await read(
			calendar(
				...event(
					"DTSTART:20260907T090000Z",
					"ORGANIZER:mailto:boss@example.com",
					"ATTENDEE;PARTSTAT=ACCEPTED:mailto:other@example.com",
				),
			),
		);
		assert.equal(participationOf(parsed.master, SELF), "Unscheduled");
	});
});

describe("participationAtSlot", () => {
	it("gives an override the reader declined its own answer, and the series the series' answer", async () => {
		const parsed = await read(
			calendar(
				...event(
					"DTSTART:20260907T090000Z",
					"DTEND:20260907T100000Z",
					"RRULE:FREQ=WEEKLY;COUNT=3",
					"ORGANIZER:mailto:boss@example.com",
					"ATTENDEE;PARTSTAT=ACCEPTED:mailto:me@example.com",
				),
				...event(
					"RECURRENCE-ID:20260914T090000Z",
					"DTSTART:20260914T090000Z",
					"DTEND:20260914T100000Z",
					"ORGANIZER:mailto:boss@example.com",
					"ATTENDEE;PARTSTAT=DECLINED:mailto:me@example.com",
				),
			),
		);

		const { occurrences } = expandCalendar(parsed, "UTC");

		assert.deepEqual(
			occurrences.map(({ recurrenceId }) => [
				recurrenceId,
				participationAtSlot(parsed, "UTC", recurrenceId, SELF),
			]),
			[
				["2026-09-07T09:00:00Z", "Accepted"],
				["2026-09-14T09:00:00Z", "Declined"],
				["2026-09-21T09:00:00Z", "Accepted"],
			],
		);
	});
});

describe("attendeesOf", () => {
	it("lists the organizer first as a yes, then each guest with their answer, and counts them", async () => {
		const parsed = await read(
			calendar(
				...event(
					"DTSTART:20260907T090000Z",
					"ORGANIZER;CN=Boss:mailto:boss@example.com",
					"ATTENDEE;CN=Boss;PARTSTAT=ACCEPTED:mailto:boss@example.com",
					"ATTENDEE;CN=Ann;PARTSTAT=TENTATIVE:mailto:ann@example.com",
					"ATTENDEE:mailto:bob@example.com",
				),
			),
		);

		const attendees = attendeesOf(parsed.master);

		assert.deepEqual(attendees, [
			{
				email: "boss@example.com",
				displayName: "Boss",
				role: "Organizer",
				status: "Accepted",
			},
			{
				email: "ann@example.com",
				displayName: "Ann",
				role: "Guest",
				status: "Tentative",
			},
			{
				email: "bob@example.com",
				displayName: "",
				role: "Guest",
				status: "NeedsAction",
			},
		]);
		assert.deepEqual(countAttendees(attendees), {
			accepted: 1,
			declined: 0,
			tentative: 1,
			needsAction: 1,
		});
	});

	it("is empty for an event nobody is invited to", async () => {
		const parsed = await read(
			calendar(
				...event("DTSTART:20260907T090000Z", "ORGANIZER:mailto:me@example.com"),
			),
		);
		assert.deepEqual(attendeesOf(parsed.master), []);
	});
});
