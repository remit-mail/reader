import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEventCalendar } from "./build.js";
import { parseCalendar } from "./parse.js";
import { attendeesOf } from "./participation.js";
import {
	applyAnswer,
	applyGuestList,
	buildSchedulingMessage,
	bumpSequence,
	distinctGuests,
} from "./scheduling.js";

const unfold = (icalData: string): string => icalData.replace(/\r\n[ \t]/g, "");

const ORGANIZER = { email: "me@example.com", displayName: "Me" };
const NOW = new Date("2026-09-01T12:00:00Z");

const built = async (): Promise<string> => {
	const result = await buildEventCalendar(
		{
			summary: "Planning",
			description: "",
			location: "",
			start: "2026-09-07T09:00:00Z",
			end: "2026-09-07T10:00:00Z",
			allDay: false,
			timeZone: "",
			status: "Confirmed",
			transparency: "Opaque",
			recurrenceRule: "",
		},
		"planning@test",
		NOW,
	);
	assert.ok(result.ok);
	return result.value;
};

const master = async (icalData: string) => {
	const parsed = await parseCalendar(icalData);
	assert.ok(parsed.ok, JSON.stringify(parsed));
	return parsed.value.master;
};

describe("applyGuestList", () => {
	it("writes the ORGANIZER and an ATTENDEE line per guest, each owed an answer", async () => {
		const icalData = await applyGuestList(await built(), ORGANIZER, [
			{ email: "Ann@Example.com", displayName: "Ann" },
			{ email: "bob@example.com", displayName: "bob@example.com" },
		]);

		assert.match(unfold(icalData), /ORGANIZER;CN=Me:mailto:me@example\.com/);
		assert.match(
			unfold(icalData),
			/ATTENDEE;CN=Ann;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:ann@example\.com/,
		);
		assert.deepEqual(
			attendeesOf(await master(icalData)).map((attendee) => attendee.email),
			["me@example.com", "ann@example.com", "bob@example.com"],
		);
	});

	it("keeps the answer a guest already gave, and drops a removed guest", async () => {
		const invited = await applyGuestList(await built(), ORGANIZER, [
			{ email: "ann@example.com", displayName: "Ann" },
			{ email: "bob@example.com", displayName: "Bob" },
		]);
		const answered = await applyAnswer(
			invited,
			"UTC",
			"ann@example.com",
			"Accepted",
			"",
		);
		assert.ok(answered.ok);

		const edited = await applyGuestList(answered.value, ORGANIZER, [
			{ email: "ann@example.com", displayName: "Ann" },
		]);

		assert.deepEqual(
			attendeesOf(await master(edited)).map(({ email, status }) => [
				email,
				status,
			]),
			[
				["me@example.com", "Accepted"],
				["ann@example.com", "Accepted"],
			],
		);
	});

	it("leaves an event with no guests with no ORGANIZER either", async () => {
		const icalData = await applyGuestList(await built(), ORGANIZER, []);
		assert.doesNotMatch(unfold(icalData), /ORGANIZER|ATTENDEE/);
	});
});

describe("distinctGuests", () => {
	it("drops the organizer and a second entry for one address", () => {
		assert.deepEqual(
			distinctGuests("me@example.com", [
				{ email: "ME@example.com", displayName: "" },
				{ email: "ann@example.com", displayName: "Ann" },
				{ email: "Ann@example.com", displayName: "Ann again" },
			]),
			[{ email: "ann@example.com", displayName: "Ann" }],
		);
	});
});

describe("bumpSequence", () => {
	it("moves SEQUENCE past what the resource carried", async () => {
		const once = await bumpSequence(await built());
		const twice = await bumpSequence(once);
		assert.equal((await master(once)).getFirstPropertyValue("sequence"), 1);
		assert.equal((await master(twice)).getFirstPropertyValue("sequence"), 2);
	});
});

describe("buildSchedulingMessage", () => {
	const guest = { email: "ann@example.com", displayName: "Ann" };

	it("builds a REQUEST carrying METHOD, the guest list and the event's SEQUENCE", async () => {
		const stored = await bumpSequence(
			await applyGuestList(await built(), ORGANIZER, [guest]),
		);

		const message = await buildSchedulingMessage(stored, {
			method: "Request",
			now: NOW,
			attendee: guest,
			recurrenceId: "",
			collectionTimezone: "UTC",
		});

		assert.match(unfold(message.icalData), /METHOD:REQUEST/);
		assert.match(unfold(message.icalData), /DTSTAMP:20260901T120000Z/);
		assert.equal(message.sequence, 1);
		assert.equal(message.summary, "Planning");
	});

	it("builds a CANCEL to a removed guest that still names them", async () => {
		const stored = await applyGuestList(await built(), ORGANIZER, []);

		const message = await buildSchedulingMessage(stored, {
			method: "Cancel",
			now: NOW,
			attendee: guest,
			recurrenceId: "",
			collectionTimezone: "UTC",
		});

		assert.match(unfold(message.icalData), /METHOD:CANCEL/);
		assert.match(unfold(message.icalData), /STATUS:CANCELLED/);
		assert.match(
			unfold(message.icalData),
			/ATTENDEE;CN=Ann:mailto:ann@example\.com/,
		);
	});

	it("builds a REPLY carrying only the guest answering", async () => {
		const invited = await applyGuestList(await built(), ORGANIZER, [
			guest,
			{ email: "bob@example.com", displayName: "Bob" },
		]);
		const answered = await applyAnswer(
			invited,
			"UTC",
			guest.email,
			"Declined",
			"",
		);
		assert.ok(answered.ok);

		const message = await buildSchedulingMessage(answered.value, {
			method: "Reply",
			now: NOW,
			attendee: guest,
			recurrenceId: "",
			collectionTimezone: "UTC",
		});

		assert.match(unfold(message.icalData), /METHOD:REPLY/);
		assert.match(unfold(message.icalData), /PARTSTAT=DECLINED/);
		assert.doesNotMatch(unfold(message.icalData), /bob@example\.com/);
	});
});
