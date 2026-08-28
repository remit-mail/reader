/**
 * The rules the strip makes on screen: what a day costs in rows, where free
 * time is drawn, which days collapse into a sentence, and what a pile-up says
 * about itself. Every one of them is a claim the design argues for, so it is
 * asserted off the rendered markup rather than off the arithmetic underneath.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { buildCalendarDay } from "../lib/agenda-time.js";
import { AgendaFlow, type AgendaFlowProps } from "./agenda-flow.js";
import type {
	CalendarDescriptor,
	CalendarEventData,
} from "./calendar-types.js";

const TODAY = "2026-06-10";
const OFFSET = "+02:00";

const calendars: CalendarDescriptor[] = [
	{
		id: "c1",
		accountId: "a1",
		accountLabel: "Work",
		name: "Northwind",
		color: "cal-3",
	},
];

function event(
	id: string,
	date: string,
	from: string,
	to: string,
	extra: Partial<CalendarEventData> = {},
): CalendarEventData {
	return {
		id,
		calendarId: "c1",
		title: id,
		start: `${date}T${from}:00${OFFSET}`,
		end: `${date}T${to}:00${OFFSET}`,
		allDay: false,
		location: "",
		notes: "",
		attendees: [],
		myRsvp: "accepted",
		threadId: "",
		threadSubject: "",
		timeZone: "Europe/Amsterdam",
		zoneCertainty: "explicit",
		recurrenceRule: "",
		seriesId: "",
		seriesException: false,
		status: "confirmed",
		...extra,
	};
}

const roadmap = event("evt_roadmap", TODAY, "10:00", "11:30", {
	title: "Q3 roadmap review",
	location: "Kaap",
	attendees: [
		{
			name: "Anna",
			email: "anna@example.test",
			rsvp: "accepted",
			role: "organizer",
		},
	],
});
const incident = event("evt_incident", TODAY, "10:30", "12:00", {
	title: "Incident review",
});
const banner: CalendarEventData = {
	...event("evt_conference", "2026-06-11", "00:00", "00:00"),
	title: "Devcon",
	start: "2026-06-11",
	end: "2026-06-12",
	allDay: true,
};

const events = [roadmap, incident, banner];

const dates = [
	TODAY,
	"2026-06-11",
	"2026-06-12",
	"2026-06-13",
	"2026-06-14",
	"2026-06-15",
	"2026-06-16",
];

const days = dates.map((date) => buildCalendarDay(date, events, TODAY));

const base: AgendaFlowProps = {
	days,
	calendars,
	density: "pills",
	today: TODAY,
	focusDate: TODAY,
	selectedEventId: "",
	onSelectEvent: () => {},
	onPickSlot: () => {},
	onZoomDay: () => {},
	onReachStart: () => {},
	onReachEnd: () => {},
	onVisibleDayChange: () => {},
};

/** React writes a marker between adjacent text nodes; a reader sees one sentence. */
const words = (html: string) => html.replaceAll("<!-- -->", "");

const render = (props: Partial<AgendaFlowProps> = {}) =>
	renderToString(createElement(AgendaFlow, { ...base, ...props }));

describe("AgendaFlow", () => {
	it("draws the days in the order it was handed them", () => {
		const html = render();
		assert.ok(
			html.indexOf("Q3 roadmap review") < html.indexOf("Devcon"),
			"the 10th is drawn before the 11th",
		);
	});

	it("names the free stretch the day still leaves open", () => {
		const html = words(render());
		assert.match(html, /10h free/);
		assert.match(html, /12:00 – 22:00/);
	});

	it("says nothing is booked rather than drawing an empty day", () => {
		assert.match(render(), /Free all day/);
	});

	it("collapses a run of empty days into one sentence", () => {
		const html = words(render());
		assert.match(html, /Fri 12 – Tue 16 Jun/);
		assert.match(html, /5 days with nothing booked/);
	});

	it("keeps the day it was focused on out of a run", () => {
		const html = words(
			render({ focusDate: "2026-06-14", today: "2026-06-14" }),
		);
		assert.doesNotMatch(html, /5 days with nothing booked/);
	});

	it("names a pile-up and offers the grid for it", () => {
		const html = words(render());
		assert.match(html, /2 at once · 10:00 – 12:00/);
		assert.match(html, /Open the grid/);
	});

	it("marks the day that is today", () => {
		assert.match(render(), /Today/);
		assert.match(render(), /Wednesday/);
	});

	it("counts the day rather than restating its rows", () => {
		assert.match(render(), /2 events · 2h booked · 1 clash/);
	});

	it("carries the calendar's hue onto every event", () => {
		assert.match(render(), /bg-cal-3-soft/);
	});

	it("falls back to one hue for a calendar it was told nothing about", () => {
		assert.match(render({ calendars: [] }), /bg-cal-1-soft/);
	});

	it("draws a banner as an all-day line", () => {
		assert.match(render(), /All day/);
	});

	it("says which event is selected rather than only colouring it", () => {
		assert.match(
			render({ selectedEventId: "evt_roadmap" }),
			/aria-pressed="true"/,
		);
	});

	it("shows where and who only at the detail reading", () => {
		assert.doesNotMatch(render(), /Kaap/);
		assert.match(words(render({ density: "detail" })), /Northwind · Kaap/);
	});

	it("gives every dot a name at the glance reading", () => {
		const html = render({ density: "dots" });
		assert.match(html, /aria-label="Q3 roadmap review"/);
		assert.doesNotMatch(html, /2 at once/);
	});

	it("names what a glance day is worth in a few characters", () => {
		const html = words(render({ density: "dots" }));
		assert.match(html, /10h free/);
		assert.match(html, /clear/);
	});

	it("gives every control a visible focus ring", () => {
		assert.match(render(), /focus-visible:ring-ring/);
	});

	it("grows every hit target when the surface is touched", () => {
		assert.match(render({ touch: true }), /min-h-12/);
	});

	it("renders whatever the owner leads today with", () => {
		const html = render({
			todayLead: createElement("p", null, "Next up in 30m"),
		});
		assert.match(html, /Next up in 30m/);
	});
});
