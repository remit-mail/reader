import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemoryCalendarStore } from "./memory-store.js";
import { parseCalendar } from "./parse.js";
import { attendeesOf } from "./participation.js";
import { provisionDefaultCalendar, putCalendarObject } from "./put.js";
import { recordCalendarReply, replyOvertakes } from "./reply.js";

const ACCOUNT_CONFIG_ID = "account-config-reply";
const ME = "me@example.com";

const vcalendar = (method: string, ...event: string[]): string =>
	[
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//test//EN",
		...(method === "" ? [] : [`METHOD:${method}`]),
		"BEGIN:VEVENT",
		"UID:meeting@test",
		...event,
		"END:VEVENT",
		"END:VCALENDAR",
	].join("\r\n");

const organized = (sequence = 1) =>
	vcalendar(
		"",
		"DTSTAMP:20260901T000000Z",
		"DTSTART:20260907T090000Z",
		"DTEND:20260907T100000Z",
		`SEQUENCE:${sequence}`,
		`ORGANIZER:mailto:${ME}`,
		"ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:ann@example.com",
	);

const reply = (partstat: string, stamp: string, sequence = 1) =>
	vcalendar(
		"REPLY",
		`DTSTAMP:${stamp}`,
		"DTSTART:20260907T090000Z",
		`SEQUENCE:${sequence}`,
		`ORGANIZER:mailto:${ME}`,
		`ATTENDEE;PARTSTAT=${partstat}:mailto:ann@example.com`,
	);

const seeded = async (icalData: string) => {
	const store = new MemoryCalendarStore();
	const collection = await provisionDefaultCalendar(store, ACCOUNT_CONFIG_ID);
	const stored = await putCalendarObject(store, {
		accountConfigId: ACCOUNT_CONFIG_ID,
		calendarId: collection.calendarId,
		resourceName: "meeting.ics",
		icalData,
	});
	assert.ok(stored.ok);
	return { store, object: stored.value };
};

const annOf = async (
	store: MemoryCalendarStore,
	calendarId: string,
	id: string,
) => {
	const object = await store.repos.calendarObject.get(calendarId, id);
	const parsed = await parseCalendar(object.icalData);
	assert.ok(parsed.ok);
	return attendeesOf(parsed.value.master).find(
		(attendee) => attendee.email === "ann@example.com",
	)?.status;
};

const record = (store: MemoryCalendarStore, icalData: string) =>
	recordCalendarReply(store, {
		accountConfigId: ACCOUNT_CONFIG_ID,
		icalData,
		selfAddresses: [ME],
	});

describe("replyOvertakes", () => {
	it("takes a first reply, a later one, and one to a newer revision", () => {
		assert.equal(
			replyOvertakes(
				{ sequence: 1, stamp: "" },
				{ sequence: 1, stamp: "20260901T100000Z" },
			),
			true,
		);
		assert.equal(
			replyOvertakes(
				{ sequence: 1, stamp: "20260901T100000Z" },
				{ sequence: 1, stamp: "20260901T110000Z" },
			),
			true,
		);
		assert.equal(
			replyOvertakes(
				{ sequence: 1, stamp: "20260901T100000Z" },
				{ sequence: 2, stamp: "20260901T110000Z" },
			),
			true,
		);
	});

	it("refuses a reply to an older revision, or one stamped no later than the answer held", () => {
		assert.equal(
			replyOvertakes(
				{ sequence: 2, stamp: "" },
				{ sequence: 1, stamp: "20260901T110000Z" },
			),
			false,
		);
		assert.equal(
			replyOvertakes(
				{ sequence: 1, stamp: "20260901T110000Z" },
				{ sequence: 1, stamp: "20260901T100000Z" },
			),
			false,
		);
		assert.equal(
			replyOvertakes(
				{ sequence: 1, stamp: "20260901T110000Z" },
				{ sequence: 1, stamp: "20260901T110000Z" },
			),
			false,
		);
	});
});

describe("recordCalendarReply", () => {
	it("writes the guest's answer onto the event the reader organizes", async () => {
		const { store, object } = await seeded(organized());

		const outcome = await record(store, reply("ACCEPTED", "20260902T100000Z"));

		assert.equal(outcome, "Recorded");
		assert.equal(
			await annOf(store, object.calendarId, object.calendarObjectId),
			"Accepted",
		);
	});

	it("keeps the newer answer when an older reply arrives after it", async () => {
		const { store, object } = await seeded(organized());
		await record(store, reply("DECLINED", "20260902T120000Z"));

		const late = await record(store, reply("ACCEPTED", "20260902T100000Z"));

		assert.equal(late, "Stale");
		assert.equal(
			await annOf(store, object.calendarId, object.calendarObjectId),
			"Declined",
		);
	});

	it("ignores a reply to an older SEQUENCE than the event now carries", async () => {
		const { store, object } = await seeded(organized(3));

		const outcome = await record(
			store,
			reply("ACCEPTED", "20260902T100000Z", 2),
		);

		assert.equal(outcome, "Stale");
		assert.equal(
			await annOf(store, object.calendarId, object.calendarObjectId),
			"NeedsAction",
		);
	});

	it("leaves an event somebody else organizes alone", async () => {
		const { store } = await seeded(
			organized().replace(
				`ORGANIZER:mailto:${ME}`,
				"ORGANIZER:mailto:boss@example.com",
			),
		);

		assert.equal(
			await record(store, reply("ACCEPTED", "20260902T100000Z")),
			"NotOrganized",
		);
	});

	it("is not a reply when the part carries another method", async () => {
		const { store } = await seeded(organized());

		assert.equal(
			await record(
				store,
				reply("ACCEPTED", "20260902T100000Z").replace(
					"METHOD:REPLY",
					"METHOD:REQUEST",
				),
			),
			"NotAReply",
		);
	});
});
