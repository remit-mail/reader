/**
 * The readings beside the strip. Each one exists because a list can answer a
 * question a grid answers badly, so what is asserted here is the answer — the
 * sentence about what is next.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	buildCalendarDay,
	type NextUp,
	readNextUp,
} from "../lib/agenda-time.js";
import { NextUpCard, type NextUpCardProps } from "./agenda-panels.js";
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
	title: string,
	date: string,
	from: string,
	to: string,
	extra: Partial<CalendarEventData> = {},
): CalendarEventData {
	return {
		id,
		calendarId: "c1",
		title,
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

const events = [
	event("evt_standup", "Standup", TODAY, "09:00", "09:30"),
	event("evt_roadmap", "Q3 roadmap review", TODAY, "10:00", "11:30", {
		location: "Kaap",
	}),
	event("evt_retro", "Retro", TODAY, "16:00", "17:00"),
	event("evt_offsite", "Offsite", "2026-06-11", "14:00", "15:00"),
];

const days = [TODAY, "2026-06-11", "2026-06-12"].map((date) =>
	buildCalendarDay(date, events, TODAY),
);

const nextUp: NextUp = readNextUp(days, `${TODAY}T09:15:00${OFFSET}`);

/** React writes a marker between adjacent text nodes; a reader sees one sentence. */
const words = (html: string) => html.replaceAll("<!-- -->", "");

const renderNextUp = (props: Partial<NextUpCardProps> = {}) =>
	renderToString(
		createElement(NextUpCard, {
			nextUp,
			calendars,
			today: TODAY,
			onSelectEvent: () => {},
			onGoTo: () => {},
			...props,
		}),
	);

describe("NextUpCard", () => {
	it("says what is running now and until when", () => {
		const html = renderNextUp();
		assert.match(html, /Now/);
		assert.match(html, /Standup/);
		assert.match(html, /until 09:30/);
	});

	it("names the next thing and how long until it", () => {
		const html = renderNextUp();
		assert.match(html, /Next · in 45m/);
		assert.match(html, /Q3 roadmap review/);
		assert.match(html, /Kaap/);
	});

	it("names the one after it without giving it a row of its own", () => {
		assert.match(words(renderNextUp()), /then Retro/);
	});

	it("drops the day prefix for today and keeps it for anything else", () => {
		const html = words(
			renderNextUp({ nextUp: readNextUp(days, `${TODAY}T18:00:00${OFFSET}`) }),
		);
		assert.match(html, /tomorrow · 14:00/);
	});

	it("offers the next free stretch as somewhere to go", () => {
		assert.match(renderNextUp(), /free/);
	});

	it("says so plainly when nothing else is booked", () => {
		const html = renderNextUp({
			nextUp: readNextUp(days, "2026-06-12T21:00:00+02:00"),
		});
		assert.match(html, /Nothing else booked\./);
	});

	it("carries the calendar's hue and falls back when it has none", () => {
		assert.match(renderNextUp(), /bg-cal-3-soft/);
		assert.match(renderNextUp({ calendars: [] }), /bg-cal-1-soft/);
	});
});
