/**
 * What a suggestion's state asks of its card, and what the day it lands on
 * already holds (#1277).
 *
 * The card is drawn off these answers alone, so a state mapped wrong is a card
 * that asks for an answer the server will refuse — a button that can only fail.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type CalendarSuggestion,
	clashesOver,
	inviteStanding,
	slotOffersOn,
	toCalendarInvite,
	toEventSuggestion,
} from "./calendar-suggestion";

const suggestion = (
	over: Partial<CalendarSuggestion> = {},
): CalendarSuggestion => ({
	suggestionId: "sug-1",
	accountConfigId: "cfg-1",
	messageId: "msg-1",
	bodyPartId: "part-1",
	icalUid: "uid-1",
	sequence: 0,
	method: "Request",
	source: "IcalendarPart",
	state: "Pending",
	summary: "Quarterly review",
	dtStart: "2026-09-01T08:00:00+00:00",
	dtEnd: "2026-09-01T09:00:00+00:00",
	allDay: false,
	location: "",
	organizer: "organizer@example.test",
	zoneCertainty: "Explicit",
	acceptedCalendarObjectId: "",
	createdAt: 0,
	updatedAt: 0,
	...over,
});

const context = {
	threadId: "thr-1",
	threadSubject: "Quarterly review",
	senderName: "Organizer",
	calendarId: "cal-1",
};

describe("inviteStanding", () => {
	it("asks for an answer only while the suggestion is pending", () => {
		assert.deepEqual(inviteStanding(suggestion()), {
			state: "pending",
			rsvp: "noReply",
		});
		assert.deepEqual(inviteStanding(suggestion({ state: "Accepted" })), {
			state: "answered",
			rsvp: "accepted",
		});
		assert.deepEqual(inviteStanding(suggestion({ state: "Declined" })), {
			state: "answered",
			rsvp: "declined",
		});
		assert.deepEqual(inviteStanding(suggestion({ state: "Superseded" })), {
			state: "superseded",
			rsvp: "noReply",
		});
	});

	it("draws no card for one the reader waved away", () => {
		assert.equal(inviteStanding(suggestion({ state: "Dismissed" })), undefined);
	});

	it("asks about a cancellation only until it is taken or kept", () => {
		assert.deepEqual(inviteStanding(suggestion({ method: "Cancel" })), {
			state: "cancelled",
			rsvp: "noReply",
		});
		assert.equal(
			inviteStanding(suggestion({ method: "Cancel", state: "Accepted" })),
			undefined,
		);
	});
});

describe("toCalendarInvite", () => {
	it("names the organiser, and the sender when the invitation names none", () => {
		assert.equal(
			toCalendarInvite(suggestion(), "pending", context).organizerName,
			"organizer@example.test",
		);
		assert.equal(
			toCalendarInvite(suggestion({ organizer: "" }), "pending", context)
				.organizerName,
			"Organizer",
		);
	});

	it("gives an untitled event a title rather than a blank heading", () => {
		const invite = toCalendarInvite(
			suggestion({ summary: "" }),
			"pending",
			context,
		);
		assert.equal(invite.proposed.title, "Untitled event");
	});
});

describe("toEventSuggestion", () => {
	it("says so when the zone the time was read on could not be resolved", () => {
		const reading = toEventSuggestion(
			suggestion({ zoneCertainty: "Ambiguous", source: "TextHeuristic" }),
			{ ...context, sender: "Organizer" },
		);
		assert.match(reading.ambiguity, /hours out/);
		assert.equal(reading.zoneCertainty, "ambiguous");
		assert.ok(reading.confidence < 1);
	});
});

describe("clashesOver", () => {
	it("names every busy stretch the span runs into and nothing beside it", () => {
		const clashes = clashesOver(
			{ start: "2026-09-01T08:00:00+00:00", end: "2026-09-01T09:00:00+00:00" },
			[
				{
					start: "2026-09-01T07:00:00+00:00",
					end: "2026-09-01T08:00:00+00:00",
				},
				{
					start: "2026-09-01T08:30:00+00:00",
					end: "2026-09-01T09:30:00+00:00",
				},
				{
					start: "2026-09-01T09:00:00+00:00",
					end: "2026-09-01T10:00:00+00:00",
				},
			],
		);
		assert.equal(clashes.length, 1);
		assert.match(clashes[0].label, /^Busy /);
	});
});

describe("slotOffersOn", () => {
	it("offers half-hours out of the free time only", () => {
		const date = "2026-09-01";
		const offers = slotOffersOn(date, []);
		assert.ok(offers.length > 0);
		assert.ok(offers.length <= 6);
		for (const offer of offers) {
			assert.equal(offer.date, date);
			const [h1, m1] = offer.startTime.split(":").map(Number);
			const [h2, m2] = offer.endTime.split(":").map(Number);
			assert.equal(h2 * 60 + m2 - (h1 * 60 + m1), 30);
		}
	});

	it("offers nothing on a day booked from end to end", () => {
		const offers = slotOffersOn("2026-09-01", [
			{
				start: new Date("2026-08-31T12:00:00").toISOString(),
				end: new Date("2026-09-02T12:00:00").toISOString(),
			},
		]);
		assert.deepEqual(offers, []);
	});
});
