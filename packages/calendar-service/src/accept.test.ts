import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CalendarSuggestionItem } from "@remit/data-ports";
import {
	CalendarSuggestionSource,
	CalendarSuggestionState,
} from "@remit/domain-enums";
import { acceptCalendarSuggestion, buildAcceptedCalendar } from "./accept.js";
import { ical } from "./fixtures.js";
import { MemoryCalendarStore } from "./memory-store.js";
import { provisionDefaultCalendar } from "./put.js";
import { recordCalendarSuggestion } from "./suggest.js";

const ACCOUNT_CONFIG_ID = "account-config-1";
const ATTENDEE = "user@example.test";
const UID = "invite-4711@example.test";

const invitation = ({
	method = "REQUEST",
	sequence = 0,
	attendees = ["ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:user@example.test"],
	extra = [] as string[],
}): string =>
	ical(
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Example Corp//Scheduler//EN",
		`METHOD:${method}`,
		"BEGIN:VEVENT",
		`UID:${UID}`,
		"DTSTAMP:20260801T090000Z",
		`SEQUENCE:${sequence}`,
		"DTSTART:20260901T080000Z",
		"DTEND:20260901T090000Z",
		"SUMMARY:Quarterly review",
		"ORGANIZER:mailto:organizer@example.test",
		...attendees,
		"X-EXAMPLE-TICKET:AB-4711",
		...extra,
		"END:VEVENT",
		"END:VCALENDAR",
	);

const suggestionOf = (
	icalData: string,
	overrides: Partial<CalendarSuggestionItem> = {},
): CalendarSuggestionItem => ({
	suggestionId: "suggestion-1",
	accountConfigId: ACCOUNT_CONFIG_ID,
	messageId: "message-1",
	bodyPartId: "body-part-1",
	icalUid: UID,
	sequence: 0,
	method: "Request",
	source: CalendarSuggestionSource.IcalendarPart,
	state: CalendarSuggestionState.Pending,
	summary: "Quarterly review",
	dtStart: "2026-09-01T08:00:00+00:00",
	dtEnd: "2026-09-01T09:00:00+00:00",
	allDay: false,
	location: "",
	organizer: "organizer@example.test",
	zoneCertainty: "Explicit",
	icalData,
	acceptedCalendarObjectId: "",
	createdAt: 0,
	updatedAt: 0,
	...overrides,
});

const provisioned = async (): Promise<{
	store: MemoryCalendarStore;
	calendarId: string;
}> => {
	const store = new MemoryCalendarStore();
	const collection = await provisionDefaultCalendar(store, ACCOUNT_CONFIG_ID);
	return { store, calendarId: collection.calendarId };
};

const recorded = async (
	store: MemoryCalendarStore,
	icalData: string,
	messageId: string,
): Promise<CalendarSuggestionItem> => {
	const result = await recordCalendarSuggestion(store.calendarSuggestion, {
		accountConfigId: ACCOUNT_CONFIG_ID,
		messageId,
		bodyPartId: "body-part-1",
		source: CalendarSuggestionSource.IcalendarPart,
		icalData,
		timezone: "UTC",
	});
	assert.ok(result.ok);
	return result.value.suggestion;
};

describe("buildAcceptedCalendar", () => {
	it("keeps the UID and the SEQUENCE the organizer sent", async () => {
		const built = await buildAcceptedCalendar(
			suggestionOf(invitation({ sequence: 3 })),
			ATTENDEE,
		);

		assert.ok(built.ok);
		assert.match(built.value, /UID:invite-4711@example\.test/);
		assert.match(built.value, /SEQUENCE:3/);
	});

	it("marks the user accepted on the line already naming them", async () => {
		const built = await buildAcceptedCalendar(
			suggestionOf(invitation({})),
			ATTENDEE,
		);

		assert.ok(built.ok);
		assert.match(built.value, /PARTSTAT=ACCEPTED/);
		assert.doesNotMatch(built.value, /NEEDS-ACTION/);
		assert.equal(built.value.match(/ATTENDEE/g)?.length, 1);
	});

	it("adds the user as an attendee when the invitation never named them", async () => {
		const built = await buildAcceptedCalendar(
			suggestionOf(invitation({ attendees: [] })),
			ATTENDEE,
		);

		assert.ok(built.ok);
		assert.match(built.value, /ATTENDEE/);
		assert.match(built.value, /PARTSTAT=ACCEPTED/);
		assert.match(built.value, /mailto:user@example\.test/);
	});

	it("drops the METHOD, which a stored resource must not carry", async () => {
		// RFC 4791 4.1: a calendar object resource is not a scheduling message.
		// Leaving METHOD in makes every client read the user's own entry as an
		// unanswered invitation.
		const built = await buildAcceptedCalendar(
			suggestionOf(invitation({})),
			ATTENDEE,
		);

		assert.ok(built.ok);
		assert.doesNotMatch(built.value, /^METHOD:/m);
	});

	it("carries through a property nobody modelled", async () => {
		const built = await buildAcceptedCalendar(
			suggestionOf(invitation({})),
			ATTENDEE,
		);

		assert.ok(built.ok);
		assert.match(built.value, /X-EXAMPLE-TICKET:AB-4711/);
	});

	it("cancels the event when the card is a cancellation", async () => {
		const built = await buildAcceptedCalendar(
			suggestionOf(invitation({ method: "CANCEL" }), { method: "Cancel" }),
			ATTENDEE,
		);

		assert.ok(built.ok);
		assert.match(built.value, /STATUS:CANCELLED/);
	});

	it("refuses a suggestion with no iCalendar behind it", async () => {
		const built = await buildAcceptedCalendar(
			suggestionOf("", { source: CalendarSuggestionSource.TextHeuristic }),
			ATTENDEE,
		);

		assert.equal(built.ok, false);
	});
});

describe("acceptCalendarSuggestion", () => {
	it("writes the resource and settles the card in one unit", async () => {
		const { store, calendarId } = await provisioned();
		const suggestion = await recorded(store, invitation({}), "message-1");

		const accepted = await acceptCalendarSuggestion(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			suggestion,
			attendee: ATTENDEE,
		});

		assert.ok(accepted.ok);
		assert.equal(
			accepted.value.suggestion.state,
			CalendarSuggestionState.Accepted,
		);
		assert.equal(
			accepted.value.suggestion.acceptedCalendarObjectId,
			accepted.value.object.calendarObjectId,
		);
		assert.equal(accepted.value.object.icalUid, UID);
		assert.equal(store.objects.size, 1);
	});

	it("expands the accepted event into the occurrence index", async () => {
		const { store, calendarId } = await provisioned();
		const suggestion = await recorded(store, invitation({}), "message-1");

		const accepted = await acceptCalendarSuggestion(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			suggestion,
			attendee: ATTENDEE,
		});

		assert.ok(accepted.ok);
		assert.equal(
			store.occurrences.get(accepted.value.object.calendarObjectId)?.length,
			1,
		);
	});

	it("accepting twice leaves one event in the calendar", async () => {
		const { store, calendarId } = await provisioned();
		const suggestion = await recorded(store, invitation({}), "message-1");

		const first = await acceptCalendarSuggestion(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			suggestion,
			attendee: ATTENDEE,
		});
		const second = await acceptCalendarSuggestion(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			suggestion,
			attendee: ATTENDEE,
		});

		assert.ok(first.ok);
		assert.ok(second.ok);
		assert.equal(store.objects.size, 1);
		assert.equal(
			second.value.object.calendarObjectId,
			first.value.object.calendarObjectId,
		);
	});

	it("accepting a later revision rewrites the event, never a second copy", async () => {
		const { store, calendarId } = await provisioned();
		const first = await recorded(
			store,
			invitation({ sequence: 0 }),
			"message-1",
		);
		await acceptCalendarSuggestion(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			suggestion: first,
			attendee: ATTENDEE,
		});

		const revision = await recorded(
			store,
			invitation({ sequence: 1 }),
			"message-2",
		);
		const accepted = await acceptCalendarSuggestion(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			suggestion: revision,
			attendee: ATTENDEE,
		});

		assert.ok(accepted.ok);
		assert.equal(store.objects.size, 1);
		assert.equal(accepted.value.object.sequence, 1);
	});

	it("a cancellation touches the calendar only once it is accepted", async () => {
		const { store, calendarId } = await provisioned();
		const request = await recorded(store, invitation({}), "message-1");
		await acceptCalendarSuggestion(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			suggestion: request,
			attendee: ATTENDEE,
		});

		const cancel = await recorded(
			store,
			invitation({ method: "CANCEL", sequence: 1 }),
			"message-2",
		);
		const before = [...store.objects.values()][0];
		assert.equal(before?.status, "Confirmed");

		const accepted = await acceptCalendarSuggestion(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			suggestion: cancel,
			attendee: ATTENDEE,
		});

		assert.ok(accepted.ok);
		assert.equal(accepted.value.object.status, "Cancelled");
		assert.equal(store.objects.size, 1);
	});

	it("writes nothing when the invitation's bytes will not parse", async () => {
		const { store, calendarId } = await provisioned();

		const accepted = await acceptCalendarSuggestion(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			suggestion: suggestionOf("BEGIN:VCALENDAR"),
			attendee: ATTENDEE,
		});

		assert.equal(accepted.ok, false);
		assert.equal(store.objects.size, 0);
	});
});
