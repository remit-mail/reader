import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AttendeeList, AttendeeRow, RsvpBadge } from "./attendee-row.js";
import type { CalendarAttendee } from "./calendar-types.js";

const attendees: CalendarAttendee[] = [
	{
		name: "Priya Natarajan",
		email: "priya@northwind.example",
		rsvp: "accepted",
		role: "organizer",
	},
	{
		name: "Dana Okafor",
		email: "dana@northwind.example",
		rsvp: "tentative",
		role: "attendee",
	},
	{
		name: "Sven Larsen",
		email: "sven@northwind.example",
		rsvp: "declined",
		role: "attendee",
	},
];

describe("RsvpBadge", () => {
	it("says the reply in words, not colour alone", () => {
		assert.match(
			renderToString(createElement(RsvpBadge, { rsvp: "noReply" })),
			/No reply/,
		);
		assert.match(
			renderToString(createElement(RsvpBadge, { rsvp: "declined" })),
			/Not coming/,
		);
	});
});

describe("AttendeeRow", () => {
	it("names the organiser", () => {
		const html = renderToString(
			createElement(AttendeeRow, { attendee: attendees[0] }),
		);
		assert.match(html, /Organiser/);
		assert.match(html, /Priya Natarajan/);
	});

	it("leaves a plain attendee unlabelled", () => {
		const html = renderToString(
			createElement(AttendeeRow, { attendee: attendees[1] }),
		);
		assert.doesNotMatch(html, /Organiser/);
	});
});

describe("AttendeeList", () => {
	it("tallies the replies above the list", () => {
		const html = renderToString(createElement(AttendeeList, { attendees }));
		assert.match(html, /3 guests/);
		assert.match(html, /1 coming/);
		assert.match(html, /1 not coming/);
	});

	it("renders nothing when nobody is invited", () => {
		assert.equal(
			renderToString(createElement(AttendeeList, { attendees: [] })),
			"",
		);
	});
});
