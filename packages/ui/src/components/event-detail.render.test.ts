import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type {
	CalendarDescriptor,
	CalendarEventData,
} from "./calendar-types.js";
import { EventDetail } from "./event-detail.js";

const calendar: CalendarDescriptor = {
	id: "c1",
	accountId: "a1",
	accountLabel: "Work",
	name: "Northwind",
	color: "cal-1",
};

const event: CalendarEventData = {
	id: "e1",
	calendarId: "c1",
	title: "Q3 roadmap review",
	start: "2026-06-10T10:00:00+02:00",
	end: "2026-06-10T11:30:00+02:00",
	allDay: false,
	location: "Room Zuid",
	notes: "Bring the staffing numbers.",
	attendees: [
		{
			name: "Priya Natarajan",
			email: "priya@northwind.example",
			rsvp: "accepted",
			role: "organizer",
		},
	],
	threadId: "thr_q3",
	threadSubject: "Q3 roadmap review — agenda + pre-read",
	timeZone: "Europe/Amsterdam",
	zoneCertainty: "local",
	recurrenceRule: "",
	seriesId: "",
	status: "confirmed",
};

const render = (overrides: Partial<CalendarEventData>, withThread = true) =>
	renderToString(
		createElement(EventDetail, {
			event: { ...event, ...overrides },
			calendar,
			whenText: "Wednesday 10 June · 10:00 – 11:30",
			onEdit: () => undefined,
			onDelete: () => undefined,
			...(withThread ? { onOpenThread: () => undefined } : {}),
		}),
	);

describe("EventDetail", () => {
	it("offers the way back to the mail the event came from", () => {
		const html = render({});
		assert.match(html, /From this thread/);
		assert.match(html, /Q3 roadmap review — agenda \+ pre-read/);
	});

	it("offers no thread link for an event nobody mailed about", () => {
		const html = render({ threadId: "", threadSubject: "" });
		assert.doesNotMatch(html, /From this thread/);
	});

	it("names the repeat rule on a series instance", () => {
		assert.match(
			render({ recurrenceRule: "Every weekday at 09:15" }),
			/Every weekday at 09:15/,
		);
	});

	it("says a zone is unknown instead of naming a guess", () => {
		const html = render({ timeZone: "", zoneCertainty: "ambiguous" });
		assert.match(html, /never a zone/);
		assert.doesNotMatch(html, /Europe\/Amsterdam/);
	});

	it("names the calendar and its account", () => {
		assert.match(render({}), /Northwind/);
	});
});
