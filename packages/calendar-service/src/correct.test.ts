import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CalendarSuggestionItem } from "@remit/data-ports";
import {
	CalendarInviteAnswer,
	CalendarSuggestionSource,
	CalendarSuggestionState,
	ZoneCertainty,
} from "@remit/domain-enums";
import { acceptCalendarSuggestion } from "./accept.js";
import type { CalendarEventFields } from "./build.js";
import { correctCalendarSuggestion } from "./correct.js";
import { ical } from "./fixtures.js";
import { MemoryCalendarStore } from "./memory-store.js";
import { provisionDefaultCalendar } from "./put.js";
import { recordCalendarSuggestion } from "./suggest.js";

const ACCOUNT_CONFIG_ID = "account-config-1";
const ATTENDEE = "user@example.test";
const UID = "invite-5120@example.test";

const invitation = ({
	method = "REQUEST",
	start = "DTSTART:20260901T080000Z",
	end = "DTEND:20260901T090000Z",
}: {
	method?: string;
	start?: string;
	end?: string;
}): string =>
	ical(
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Example Corp//Scheduler//EN",
		`METHOD:${method}`,
		"BEGIN:VEVENT",
		`UID:${UID}`,
		"DTSTAMP:20260801T090000Z",
		"SEQUENCE:2",
		start,
		end,
		"SUMMARY:Quarterly review",
		"LOCATION:Room 4",
		"ORGANIZER:mailto:organizer@example.test",
		"ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:user@example.test",
		"X-EXAMPLE-TICKET:AB-5120",
		"END:VEVENT",
		"END:VCALENDAR",
	);

const pendingIn = async (icalData: string) => {
	const store = new MemoryCalendarStore();
	const collection = await provisionDefaultCalendar(store, ACCOUNT_CONFIG_ID);
	const recorded = await recordCalendarSuggestion(store.calendarSuggestion, {
		accountConfigId: ACCOUNT_CONFIG_ID,
		messageId: "message-1",
		bodyPartId: "body-part-1",
		source: CalendarSuggestionSource.IcalendarPart,
		icalData,
		timezone: "UTC",
	});
	assert.ok(recorded.ok);
	return {
		store,
		calendarId: collection.calendarId,
		suggestion: recorded.value.suggestion,
	};
};

const acceptCorrected = async (
	store: MemoryCalendarStore,
	calendarId: string,
	suggestion: CalendarSuggestionItem,
	patch: Partial<CalendarEventFields>,
) => {
	const corrected = await correctCalendarSuggestion(suggestion, patch, "UTC");
	if (!corrected.ok) return corrected;
	return acceptCalendarSuggestion(store, {
		accountConfigId: ACCOUNT_CONFIG_ID,
		calendarId,
		suggestion: corrected.value,
		attendee: ATTENDEE,
		answer: CalendarInviteAnswer.Accepted,
	});
};

describe("correctCalendarSuggestion", () => {
	it("writes the corrected event and settles the card as accepted", async () => {
		const { store, calendarId, suggestion } = await pendingIn(invitation({}));

		const accepted = await acceptCorrected(store, calendarId, suggestion, {
			summary: "Quarterly review, moved",
			start: "2026-09-01T13:00:00+00:00",
			end: "2026-09-01T14:30:00+00:00",
			allDay: false,
			timeZone: "",
		});

		assert.ok(accepted.ok);
		const object = accepted.value.object;
		assert.ok(object);
		assert.equal(object.summary, "Quarterly review, moved");
		assert.equal(Date.parse(object.dtStart), Date.parse("2026-09-01T13:00Z"));
		assert.equal(Date.parse(object.dtEnd), Date.parse("2026-09-01T14:30Z"));
		assert.equal(object.icalUid, UID);
		assert.match(object.icalData, /LOCATION:Room 4/);
		assert.match(object.icalData, /X-EXAMPLE-TICKET:AB-5120/);
		assert.match(object.icalData, /PARTSTAT=ACCEPTED/);

		const settled = await store.calendarSuggestion.get(
			ACCOUNT_CONFIG_ID,
			suggestion.suggestionId,
		);
		assert.equal(settled.state, CalendarSuggestionState.Accepted);
		assert.equal(settled.acceptedCalendarObjectId, object.calendarObjectId);
	});

	it("places an unresolvable zone on the clock the reader picked", async () => {
		const { store, calendarId, suggestion } = await pendingIn(
			invitation({
				start: "DTSTART;TZID=Nowhere Standard Time:20260901T090000",
				end: "DTEND;TZID=Nowhere Standard Time:20260901T100000",
			}),
		);
		assert.equal(suggestion.zoneCertainty, ZoneCertainty.Ambiguous);

		const accepted = await acceptCorrected(store, calendarId, suggestion, {
			start: "2026-09-01T09:00:00+02:00",
			end: "2026-09-01T10:00:00+02:00",
			allDay: false,
			timeZone: "Europe/Amsterdam",
		});

		assert.ok(accepted.ok);
		const object = accepted.value.object;
		assert.ok(object);
		assert.equal(object.zoneCertainty, ZoneCertainty.Explicit);
		assert.equal(Date.parse(object.dtStart), Date.parse("2026-09-01T07:00Z"));
		assert.match(
			object.icalData,
			/DTSTART;TZID=Europe\/Amsterdam:20260901T090000/,
		);
	});

	it("refuses a cancellation and leaves the card waiting", async () => {
		const { store, calendarId, suggestion } = await pendingIn(
			invitation({ method: "CANCEL" }),
		);

		const refused = await acceptCorrected(store, calendarId, suggestion, {
			summary: "Anything",
		});

		assert.equal(refused.ok, false);
		assert.equal(store.objects.size, 0);
		const untouched = await store.calendarSuggestion.get(
			ACCOUNT_CONFIG_ID,
			suggestion.suggestionId,
		);
		assert.equal(untouched.state, CalendarSuggestionState.Pending);
	});

	it("refuses a correction the event cannot take and writes nothing", async () => {
		const { store, calendarId, suggestion } = await pendingIn(invitation({}));

		const refused = await acceptCorrected(store, calendarId, suggestion, {
			start: "2026-09-01T13:00:00",
		});

		assert.equal(refused.ok, false);
		assert.equal(store.objects.size, 0);
	});
});
