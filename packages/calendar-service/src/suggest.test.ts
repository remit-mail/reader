import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveCalendarSuggestionId } from "@remit/data-ports/id";
import {
	CalendarInviteMethod,
	CalendarSuggestionSource,
	CalendarSuggestionState,
} from "@remit/domain-enums";
import { AMSTERDAM_VTIMEZONE, ical } from "./fixtures.js";
import { MemoryCalendarStore } from "./memory-store.js";
import { projectSuggestion, recordCalendarSuggestion } from "./suggest.js";

const ACCOUNT_CONFIG_ID = "account-config-1";
const UID = "invite-4711@example.test";

const invitation = ({
	method = "REQUEST",
	sequence = 0,
	summary = "Quarterly review",
	uid = UID,
	extra = [] as string[],
}): string =>
	ical(
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Example Corp//Scheduler//EN",
		`METHOD:${method}`,
		...AMSTERDAM_VTIMEZONE,
		"BEGIN:VEVENT",
		`UID:${uid}`,
		"DTSTAMP:20260801T090000Z",
		`SEQUENCE:${sequence}`,
		"DTSTART;TZID=Europe/Amsterdam:20260901T100000",
		"DTEND;TZID=Europe/Amsterdam:20260901T110000",
		`SUMMARY:${summary}`,
		"LOCATION:Room 4",
		"ORGANIZER;CN=Ada:mailto:organizer@example.test",
		"ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:user@example.test",
		...extra,
		"END:VEVENT",
		"END:VCALENDAR",
	);

const record = (
	store: MemoryCalendarStore,
	icalData: string,
	messageId: string,
) =>
	recordCalendarSuggestion(store.calendarSuggestion, {
		accountConfigId: ACCOUNT_CONFIG_ID,
		messageId,
		bodyPartId: "body-part-1",
		source: CalendarSuggestionSource.IcalendarPart,
		icalData,
		timezone: "Europe/Amsterdam",
	});

describe("projectSuggestion", () => {
	it("reads the facts a card is drawn from", async () => {
		const projected = await projectSuggestion(
			invitation({}),
			"Europe/Amsterdam",
		);

		assert.ok(projected.ok);
		assert.equal(projected.value.icalUid, UID);
		assert.equal(projected.value.method, CalendarInviteMethod.Request);
		assert.equal(projected.value.summary, "Quarterly review");
		assert.equal(projected.value.location, "Room 4");
		assert.equal(projected.value.organizer, "organizer@example.test");
		assert.equal(projected.value.dtStart, "2026-09-01T10:00:00+02:00");
		assert.equal(projected.value.dtEnd, "2026-09-01T11:00:00+02:00");
		assert.equal(projected.value.allDay, false);
	});

	it("reads a cancellation as a cancellation", async () => {
		const projected = await projectSuggestion(
			invitation({ method: "CANCEL", sequence: 2 }),
			"Europe/Amsterdam",
		);

		assert.ok(projected.ok);
		assert.equal(projected.value.method, CalendarInviteMethod.Cancel);
		assert.equal(projected.value.sequence, 2);
	});

	it("reads a bare .ics as carrying no method", async () => {
		const bare = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Example//EN",
			"BEGIN:VEVENT",
			`UID:${UID}`,
			"DTSTAMP:20260801T090000Z",
			"DTSTART:20260901T080000Z",
			"DTEND:20260901T090000Z",
			"SUMMARY:Lunch",
			"END:VEVENT",
			"END:VCALENDAR",
		);

		const projected = await projectSuggestion(bare, "Europe/Amsterdam");

		assert.ok(projected.ok);
		assert.equal(projected.value.method, CalendarInviteMethod.None);
		assert.equal(projected.value.organizer, "");
		assert.equal(projected.value.location, "");
	});

	it("refuses unreadable iCalendar as a value, not a throw", async () => {
		const projected = await projectSuggestion("not a calendar", "UTC");

		assert.equal(projected.ok, false);
		assert.ok(!projected.ok && projected.error.code);
	});
});

describe("recordCalendarSuggestion", () => {
	it("writes a fixture invitation as one Pending suggestion", async () => {
		const store = new MemoryCalendarStore();

		const recorded = await record(store, invitation({}), "message-1");

		assert.ok(recorded.ok);
		assert.equal(
			recorded.value.suggestion.state,
			CalendarSuggestionState.Pending,
		);
		assert.equal(recorded.value.suggestion.icalUid, UID);
		assert.equal(
			recorded.value.suggestion.suggestionId,
			deriveCalendarSuggestionId("message-1", "body-part-1", UID),
		);
		assert.equal(recorded.value.suggestion.acceptedCalendarObjectId, "");
		assert.deepEqual(recorded.value.superseded, []);
	});

	it("stores the invitation's bytes unchanged", async () => {
		const store = new MemoryCalendarStore();
		const bytes = invitation({});

		const recorded = await record(store, bytes, "message-1");

		assert.ok(recorded.ok);
		assert.equal(recorded.value.suggestion.icalData, bytes);
	});

	it("re-reading the same message rewrites the one row", async () => {
		const store = new MemoryCalendarStore();

		await record(store, invitation({}), "message-1");
		await record(store, invitation({}), "message-1");

		assert.equal(store.suggestions.size, 1);
	});

	it("supersedes the earlier revision and offers the new one", async () => {
		const store = new MemoryCalendarStore();

		const first = await record(store, invitation({ sequence: 0 }), "message-1");
		const second = await record(
			store,
			invitation({ sequence: 1, summary: "Quarterly review, moved" }),
			"message-2",
		);

		assert.ok(first.ok);
		assert.ok(second.ok);
		assert.equal(
			second.value.suggestion.state,
			CalendarSuggestionState.Pending,
		);
		assert.deepEqual(
			second.value.superseded.map((row) => row.suggestionId),
			[first.value.suggestion.suggestionId],
		);
		const superseded = await store.calendarSuggestion.get(
			ACCOUNT_CONFIG_ID,
			first.value.suggestion.suggestionId,
		);
		assert.equal(superseded.state, CalendarSuggestionState.Superseded);
	});

	it("leaves the earlier revision alone when the sequence did not move", async () => {
		// SEQUENCE is the organizer's revision counter. A resend of the same
		// revision — a redelivery, a second copy filed elsewhere — is not a new
		// revision, and retiring the card the user is looking at would be a lie.
		const store = new MemoryCalendarStore();

		const first = await record(store, invitation({ sequence: 3 }), "message-1");
		const second = await record(
			store,
			invitation({ sequence: 3 }),
			"message-2",
		);

		assert.ok(first.ok);
		assert.ok(second.ok);
		assert.deepEqual(second.value.superseded, []);
		const earlier = await store.calendarSuggestion.get(
			ACCOUNT_CONFIG_ID,
			first.value.suggestion.suggestionId,
		);
		assert.equal(earlier.state, CalendarSuggestionState.Pending);
	});

	it("leaves another event's card alone", async () => {
		const store = new MemoryCalendarStore();

		const other = await record(
			store,
			invitation({ uid: "other@example.test" }),
			"message-1",
		);
		const mine = await record(store, invitation({ sequence: 4 }), "message-2");

		assert.ok(other.ok);
		assert.ok(mine.ok);
		assert.deepEqual(mine.value.superseded, []);
	});

	it("never retires a suggestion the user already answered", async () => {
		// A decision is the user's. A later revision arriving does not erase the
		// event they added; a cancellation reaches the calendar only when they
		// accept the cancellation card.
		const store = new MemoryCalendarStore();

		const first = await record(store, invitation({ sequence: 0 }), "message-1");
		assert.ok(first.ok);
		await store.calendarSuggestion.settle(
			ACCOUNT_CONFIG_ID,
			first.value.suggestion.suggestionId,
			{
				state: CalendarSuggestionState.Accepted,
				acceptedCalendarObjectId: "cal-object-1",
			},
		);

		const second = await record(
			store,
			invitation({ sequence: 1 }),
			"message-2",
		);

		assert.ok(second.ok);
		assert.deepEqual(second.value.superseded, []);
		const answered = await store.calendarSuggestion.get(
			ACCOUNT_CONFIG_ID,
			first.value.suggestion.suggestionId,
		);
		assert.equal(answered.state, CalendarSuggestionState.Accepted);
	});

	it("records a cancellation as a card of its own, touching nothing", async () => {
		const store = new MemoryCalendarStore();

		const cancel = await record(
			store,
			invitation({ method: "CANCEL", sequence: 5 }),
			"message-3",
		);

		assert.ok(cancel.ok);
		assert.equal(cancel.value.suggestion.method, CalendarInviteMethod.Cancel);
		assert.equal(
			cancel.value.suggestion.state,
			CalendarSuggestionState.Pending,
		);
		assert.equal(store.objects.size, 0);
	});

	it("writes nothing when the iCalendar will not parse", async () => {
		const store = new MemoryCalendarStore();

		const recorded = await record(store, "BEGIN:VCALENDAR", "message-1");

		assert.equal(recorded.ok, false);
		assert.equal(store.suggestions.size, 0);
	});
});
