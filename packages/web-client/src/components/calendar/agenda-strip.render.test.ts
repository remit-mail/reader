/**
 * What the agenda puts on screen.
 *
 * Every claim here is one the strip makes to a reader rather than one the
 * arithmetic makes to itself: that it opened on the day the address named, that
 * a week with nothing in it is a sentence rather than seven blank screens, that
 * an afternoon booked on a calendar it is not drawing is not offered as free,
 * and that a read it was refused says so instead of drawing an empty diary.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildCalendarDay,
	type CalendarDescriptor,
	type CalendarEventData,
	datesBetween,
	freeStretchesOn,
} from "@remit/ui";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { freeStretchesByDate, startOfDay } from "@/hooks/calendar";
import { AgendaStrip, type AgendaStripProps } from "./AgendaStrip.js";

const TODAY = "2026-06-10";
/**
 * Events are read off the wall time they print, so their offset is arbitrary.
 * A busy span is an instant, so it carries this machine's own offset and the
 * suite answers the same in Los Angeles as in Amsterdam.
 */
const OFFSET = "+02:00";
const busyAt = (date: string, time: string): string =>
	`${date}T${time}:00${startOfDay(date).slice(19)}`;
const NOW = `${TODAY}T09:30:00${OFFSET}`;
const WORK = "cal_work";

const calendars: CalendarDescriptor[] = [
	{
		id: WORK,
		accountId: "acct_work",
		accountLabel: "Work",
		name: "Northwind",
		color: "cal-3",
	},
];

const event = (
	id: string,
	date: string,
	from: string,
	to: string,
	title = id,
): CalendarEventData => ({
	id,
	calendarId: WORK,
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
});

const events = [
	event("evt_roadmap", TODAY, "10:00", "11:30", "Q3 roadmap review"),
	event("evt_retro", "2026-06-18", "16:00", "17:00", "Retro"),
];

const dates = datesBetween("2026-06-08", "2026-06-20");
const days = dates.map((date) => buildCalendarDay(date, events, TODAY));

const noop = () => {};

/** Every day answered for, which is what the cases below are about. */
const NOTHING_PENDING: ReadonlySet<string> = new Set();

const base: AgendaStripProps = {
	days,
	calendars,
	density: "comfortable",
	today: TODAY,
	anchorDate: TODAY,
	now: NOW,
	selectedEventId: "",
	// The gaps between the rows: what the strip reads before the merged busy
	// spans land, and what every case here but one is measured against.
	freeOn: freeStretchesOn,
	loadingDates: NOTHING_PENDING,
	onSelectEvent: noop,
	onPickSlot: noop,
	onZoomDay: noop,
	onGoToDate: noop,
	onReachStart: noop,
	onReachEnd: noop,
	onVisibleDayChange: noop,
};

/** React writes a marker between adjacent text nodes; a reader sees one sentence. */
const words = (html: string) => html.replaceAll("<!-- -->", "");

const render = (props: Partial<AgendaStripProps> = {}): string =>
	words(
		renderToString(
			createElement(AgendaStrip, { ...base, ...props }) as ReactElement,
		),
	);

describe("the day the address named", () => {
	it("names it under the sticky header the strip opens on", () => {
		assert.match(render(), /Wednesday/);
		assert.match(render(), />Today</);
	});

	it("keeps it out of a run, however empty it is", () => {
		const quiet = dates.map((date) => buildCalendarDay(date, [], TODAY));
		const html = render({ days: quiet, anchorDate: "2026-06-16" });
		// The run either side of the 16th, rather than one run over it.
		assert.match(html, /5 days with nothing booked/);
		assert.match(html, /4 days with nothing booked/);
	});
});

describe("a run of days with nothing on them", () => {
	it("collapses into one sentence rather than seven empty screens", () => {
		const html = render();
		assert.match(html, /Thu 11 – Wed 17 Jun/);
		assert.match(html, /7 days with nothing booked/);
	});
});

describe("free time", () => {
	/**
	 * The reader has unticked the calendar those meetings are on, so the strip
	 * draws nothing on the 11th. They are booked all morning regardless, and
	 * "Free all day" is the one answer this view must never give.
	 */
	it("comes from the merged busy spans, not from the rows on screen", () => {
		const free = freeStretchesByDate(dates, [
			{
				start: busyAt("2026-06-11", "09:00"),
				end: busyAt("2026-06-11", "16:00"),
			},
		]);
		const html = render({
			anchorDate: "2026-06-11",
			freeOn: (day) => free.get(day.date) ?? [],
		});
		assert.doesNotMatch(html, /Free all day/);
		assert.match(html, /16:00 – 22:00/);
	});

	it("names the stretch a booked day still leaves open", () => {
		assert.match(render(), /11:30 – 22:00/);
	});
});

describe("what is next", () => {
	it("leads today, so it is the first thing on screen and the first gone", () => {
		const html = render();
		assert.match(html, /Q3 roadmap review/);
		assert.match(html, /Next · in 30m/);
	});

	it("says so plainly when the diary is empty ahead", () => {
		const past = [event("evt_done", TODAY, "08:00", "09:00", "Breakfast")];
		const html = render({
			days: dates.map((date) => buildCalendarDay(date, past, TODAY)),
		});
		assert.match(html, /Nothing else booked/);
	});
});

/**
 * One preference for the whole calendar, which the grid already reads. The
 * strip's third reading — a month of coloured dots with no titles on it — is
 * not reachable from Glance on purpose: Glance says how much of a day fits, not
 * whether to say what is on it.
 */
describe("the density the device holds", () => {
	it("names the calendar an event is on at the detail reading", () => {
		assert.match(render({ density: "comfortable" }), /Northwind/);
	});

	it("drops that line at a glance, still naming every event", () => {
		const html = render({ density: "compact" });
		assert.match(html, /Q3 roadmap review/);
		assert.doesNotMatch(html, /Northwind/);
	});
});

describe("a read that did not happen", () => {
	it("states the refusal rather than drawing an empty diary", () => {
		const html = render({
			days: [],
			error: new Error("The window has to be shorter than a year."),
		});
		assert.match(html, /load these days/);
		assert.match(html, /shorter than a year/);
		assert.doesNotMatch(html, /days with nothing booked/);
	});

	/**
	 * The bug this pins: a week still in flight has no events, so every day of
	 * it built as "nothing booked" and a run of them collapsed into "7 days with
	 * nothing booked" — a claim about a diary nobody had read yet.
	 */
	it("draws an unanswered day as a skeleton, never as a day with nothing on it", () => {
		const pending = new Set(["2026-06-11", "2026-06-12", "2026-06-13"]);
		const html = render({ loadingDates: pending });
		for (const date of pending) {
			assert.match(html, new RegExp(`agenda-day-pending-${date}`));
		}
		assert.match(html, /aria-busy="true"/);
		// The run that would have swallowed them, had they been read as empty.
		assert.doesNotMatch(html, /Thu 11 – /);
	});

	it("keeps the days that have answered while their neighbours arrive", () => {
		const html = render({ loadingDates: new Set(["2026-06-11"]) });
		assert.match(html, /Q3 roadmap review/);
		assert.match(html, /agenda-day-pending-2026-06-11/);
	});

	it("holds back what is next until today has answered", () => {
		assert.match(render(), /Next · in 30m/);
		assert.doesNotMatch(
			render({ loadingDates: new Set([TODAY]) }),
			/Nothing else booked/,
		);
	});
});
