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

	it("renders exactly what it always did for a caller with nothing to open", () => {
		const html = renderToString(
			createElement(AttendeeRow, { attendee: attendees[1] }),
		);
		assert.match(html, /^<div class="flex min-h-9 items-center gap-2\.5">/);
		assert.match(html, /<span class="min-w-0 flex-1">/);
		assert.doesNotMatch(
			html,
			/<button|aria-expanded|w-full|text-left|relative/,
		);
	});

	it("becomes a control where a name leads somewhere", () => {
		const html = renderToString(
			createElement(AttendeeRow, {
				attendee: attendees[0],
				onActivate: () => undefined,
			}),
		);
		assert.match(html, /<button/);
		assert.match(html, /aria-expanded="false"/);
	});

	it("says the row is the one standing open", () => {
		const html = renderToString(
			createElement(AttendeeRow, {
				attendee: attendees[0],
				active: true,
				onActivate: () => undefined,
			}),
		);
		assert.match(html, /aria-expanded="true"/);
	});

	it("gives a thumb a row it can hit", () => {
		const html = renderToString(
			createElement(AttendeeRow, {
				attendee: attendees[0],
				onActivate: () => undefined,
				touch: true,
			}),
		);
		assert.match(html, /min-h-11/);
		assert.doesNotMatch(html, /min-h-9/);
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

	it("leaves the markup it always had when nothing can be opened", () => {
		const html = renderToString(createElement(AttendeeList, { attendees }));
		assert.doesNotMatch(html, /<button|aria-expanded|w-full/);
		assert.doesNotMatch(html, /<div>/);
		assert.equal(
			html.match(/<div class="flex min-h-9 items-center gap-2\.5">/g)?.length,
			attendees.length,
		);
	});

	it("makes every row a control when a guest can be opened", () => {
		const html = renderToString(
			createElement(AttendeeList, { attendees, onActivate: () => undefined }),
		);
		assert.equal(html.match(/<button/g)?.length, attendees.length);
	});

	it("puts the context under the guest it is about and under no other", () => {
		const html = renderToString(
			createElement(AttendeeList, {
				attendees,
				activeEmail: "dana@northwind.example",
				onActivate: () => undefined,
				renderContext: (attendee) =>
					createElement("p", null, `Recent mail · ${attendee.name}`),
			}),
		);
		assert.match(html, /Recent mail · Dana Okafor/);
		assert.doesNotMatch(html, /Recent mail · Priya Natarajan/);
	});

	it("names the disclosure the open row controls", () => {
		const html = renderToString(
			createElement(AttendeeList, {
				attendees,
				activeEmail: "dana@northwind.example",
				onActivate: () => undefined,
				renderContext: (attendee) =>
					createElement("p", null, `Recent mail · ${attendee.name}`),
			}),
		);
		const controls = html.match(/aria-controls="([^"]+)"/g) ?? [];
		assert.equal(controls.length, 1);
		const id = /aria-controls="([^"]+)"/.exec(html)?.[1];
		assert.ok(id);
		assert.ok(html.includes(`<div id="${id}"`));
	});

	it("opens no context for a guest who is not on the list", () => {
		const html = renderToString(
			createElement(AttendeeList, {
				attendees,
				activeEmail: "nobody@northwind.example",
				onActivate: () => undefined,
				renderContext: (attendee) =>
					createElement("p", null, `Recent mail · ${attendee.name}`),
			}),
		);
		assert.doesNotMatch(html, /Recent mail/);
	});
});
