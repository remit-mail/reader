/**
 * What each zoom puts on screen.
 *
 * The route is one route for all five views, so "the view mounts its own
 * component" is a decision this pane makes and the place to assert it. A zoom
 * that is not drawn yet says so out loud: an empty surface would be
 * indistinguishable from a week with nothing in it, which is the dead route
 * this stage exists to avoid.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CalendarColorId, CalendarEventData } from "@remit/ui";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { CalendarWorkspace } from "./CalendarWorkspace.js";

const TIME_ZONE = "Europe/Amsterdam";
const DATE = "2026-06-10";
const NOW = `${DATE}T09:30:00+02:00`;
const CALENDAR = "cal_work";

const colorByCalendarId: Record<string, CalendarColorId> = {
	[CALENDAR]: "cal-1",
};

const roadmap: CalendarEventData = {
	id: "roadmap",
	calendarId: CALENDAR,
	title: "Roadmap review",
	start: `${DATE}T10:00:00+02:00`,
	end: `${DATE}T11:00:00+02:00`,
	allDay: false,
	location: "",
	notes: "",
	attendees: [],
	myRsvp: "accepted",
	threadId: "",
	threadSubject: "",
	timeZone: TIME_ZONE,
	zoneCertainty: "explicit",
	recurrenceRule: "",
	seriesId: "",
	seriesException: false,
	status: "confirmed",
};

const noop = () => {};

/**
 * The calendar engine schedules browser timers while it renders. Nothing mounts
 * here, so nothing ever clears them and the suite would sit on a live event
 * loop after its last assertion. Take them back.
 */
const render = (
	view: "year" | "month" | "week" | "day" | "agenda",
	events: CalendarEventData[] = [roadmap],
): string => {
	const scheduled: ReturnType<typeof setTimeout>[] = [];
	const native = globalThis.setTimeout;
	globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
		const handle = native(...args);
		scheduled.push(handle);
		return handle;
	}) as typeof globalThis.setTimeout;
	try {
		return renderToString(
			createElement(CalendarWorkspace, {
				view,
				date: DATE,
				events,
				colorByCalendarId,
				density: "comfortable" as const,
				selectedEventId: "",
				timeZone: TIME_ZONE,
				now: NOW,
				onChangeView: noop,
				onToday: noop,
				onStep: noop,
				onChangeDensity: noop,
				onSelectEvent: noop,
				onPickSlot: noop,
			}),
		);
	} finally {
		globalThis.setTimeout = native;
		for (const handle of scheduled) clearTimeout(handle);
	}
};

describe("the zoom the address names", () => {
	it("draws the grid for the week and the day", () => {
		for (const view of ["week", "day"] as const) {
			const html = render(view);
			assert.ok(
				html.includes("Roadmap review"),
				`${view} did not draw the events it was given`,
			);
			assert.equal(html.includes("Not built yet"), false);
		}
	});

	it("says so for a zoom that is not drawn yet", () => {
		for (const view of ["year", "month", "agenda"] as const) {
			const html = render(view);
			assert.ok(
				html.includes(`calendar-placeholder-${view}`),
				`${view} rendered no placeholder`,
			);
			assert.ok(html.includes("Not built yet"));
			assert.ok(html.includes("Week and Day work now."));
		}
	});

	it("names the agenda's own stage rather than a generic one", () => {
		assert.ok(render("agenda").includes("scrolling day strip"));
	});
});

describe("the toolbar", () => {
	it("offers every zoom, whichever one is on", () => {
		const html = render("year");
		for (const label of ["Year", "Month", "Week", "Day", "Agenda"]) {
			assert.ok(html.includes(`>${label}<`), `no way to reach ${label}`);
		}
	});

	it("offers back, forward and today at a zoom that draws no grid", () => {
		const html = render("month");
		assert.ok(html.includes('aria-label="Previous"'));
		assert.ok(html.includes('aria-label="Next"'));
		assert.ok(html.includes(">Today<"));
	});

	it("names the range before the grid has measured one", () => {
		// The words are the device's locale's; the year is the part that is this
		// component's answer rather than `Intl`'s.
		assert.ok(render("month").includes("2026"));
		assert.ok(render("year").includes("2026"));
	});

	it("carries the density control, which the address never names", () => {
		const html = render("week");
		assert.ok(html.includes("Calendar density"));
		assert.ok(html.includes(">Detail<"));
		assert.ok(html.includes(">Glance<"));
	});
});

describe("a week with nothing in it", () => {
	it("draws the grid rather than an empty surface", () => {
		const html = render("week", []);
		assert.equal(html.includes("Not built yet"), false);
		assert.ok(html.includes('aria-label="Previous"'));
	});
});
