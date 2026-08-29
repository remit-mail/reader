/**
 * The rules the grid owns, read off the markup it produces: which day an event
 * lands on, which band it lands in, which day is today, and what a week with
 * nothing in it says. The engine's pixel geometry — how far along a column an
 * overlap sits — is measured in a browser and belongs to a story, not here.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { CalendarGrid, type CalendarGridProps } from "./calendar-grid.js";
import type { CalendarEventData } from "./calendar-types.js";

const TIME_ZONE = "Europe/Amsterdam";
const TODAY = "2026-06-10";
const TOMORROW = "2026-06-11";
const NOW = `${TODAY}T09:30:00+02:00`;

const WORK = "cal_work";
const HOME = "cal_home";

const template: CalendarEventData = {
	id: "",
	calendarId: WORK,
	title: "",
	start: "",
	end: "",
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

const anEvent = (over: Partial<CalendarEventData>): CalendarEventData => ({
	...template,
	...over,
});

const roadmap = anEvent({
	id: "roadmap",
	title: "Roadmap review",
	start: `${TODAY}T10:00:00+02:00`,
	end: `${TODAY}T11:00:00+02:00`,
});

const dentist = anEvent({
	id: "dentist",
	calendarId: HOME,
	title: "Dentist",
	start: `${TODAY}T10:30:00+02:00`,
	end: `${TODAY}T11:30:00+02:00`,
});

const handover = anEvent({
	id: "handover",
	title: "Handover",
	start: `${TOMORROW}T09:00:00+02:00`,
	end: `${TOMORROW}T09:30:00+02:00`,
});

const conference = anEvent({
	id: "conference",
	title: "Conference",
	allDay: true,
	start: TOMORROW,
	end: "2026-06-12",
});

const base: CalendarGridProps = {
	view: "week",
	date: TODAY,
	events: [],
	colorByCalendarId: { [WORK]: "cal-3", [HOME]: "cal-5" },
	density: "comfortable",
	selectedEventId: "",
	timeZone: TIME_ZONE,
	now: NOW,
	onSelectEvent: () => undefined,
	onPickSlot: () => undefined,
	onRangeChange: () => undefined,
};

interface Chip {
	title: string;
	time: string;
	/** The day column the chip was drawn in. */
	date: string;
	/** A block filling its slot, as opposed to the all-day band's pill. */
	timed: boolean;
	tabbable: boolean;
	classes: string[];
}

/**
 * The engine schedules browser timers while it renders. Nothing mounts here, so
 * nothing ever clears them and the suite would sit on a live event loop after
 * its last assertion. Take them back: a timer with no calendar left to tick for
 * is not work.
 */
function grid(over: Partial<CalendarGridProps> = {}): HTMLElement {
	const scheduled: ReturnType<typeof setTimeout>[] = [];
	const native = globalThis.setTimeout;
	globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
		const handle = native(...args);
		scheduled.push(handle);
		return handle;
	}) as typeof globalThis.setTimeout;
	const root = document.createElement("div");
	try {
		root.innerHTML = renderToString(
			createElement(CalendarGrid, { ...base, ...over }),
		);
	} finally {
		globalThis.setTimeout = native;
		for (const handle of scheduled) clearTimeout(handle);
	}
	return root;
}

function chips(root: HTMLElement): Chip[] {
	return Array.from(root.querySelectorAll<HTMLElement>("[role=button]"))
		.filter((el) => el.querySelector(".font-medium") !== null)
		.map((el) => ({
			title: el.querySelector(".font-medium")?.textContent ?? "",
			time: el.querySelector(".tabular-nums")?.textContent ?? "",
			date: el.closest<HTMLElement>("[data-date]")?.dataset.date ?? "",
			timed: !el.classList.contains("my-px"),
			tabbable: el.getAttribute("tabindex") === "0",
			classes: Array.from(el.classList),
		}));
}

function chip(root: HTMLElement, title: string): Chip {
	const found = chips(root).find((candidate) => candidate.title === title);
	assert.ok(found, `no chip drawn for ${title}`);
	return found;
}

describe("CalendarGrid placement", () => {
	it("draws a timed event in its own day's column, at its own start", () => {
		const drawn = chip(grid({ events: [roadmap, handover] }), "Roadmap review");
		assert.equal(drawn.date, TODAY);
		assert.equal(drawn.time, "10:00");
		assert.equal(drawn.timed, true);
	});

	it("sorts each event onto its own day rather than the range's first", () => {
		const root = grid({ events: [roadmap, handover] });
		assert.equal(chip(root, "Handover").date, TOMORROW);
		assert.equal(chip(root, "Handover").time, "09:00");
	});

	it("names the start only, so a column is never a range of digits", () => {
		assert.equal(
			chip(grid({ events: [roadmap] }), "Roadmap review").time,
			"10:00",
		);
	});

	it("keeps both sides of an overlap in the day, each in its own hue", () => {
		const root = grid({ events: [roadmap, dentist] });
		const drawn = chips(root);
		assert.equal(drawn.length, 2);
		assert.ok(drawn.every((one) => one.date === TODAY));
		assert.ok(chip(root, "Roadmap review").classes.includes("bg-cal-3-soft"));
		assert.ok(chip(root, "Dentist").classes.includes("bg-cal-5-soft"));
	});

	it("falls back to the first hue for a calendar nobody coloured", () => {
		const root = grid({ events: [roadmap], colorByCalendarId: {} });
		assert.ok(chip(root, "Roadmap review").classes.includes("bg-cal-1-soft"));
	});
});

describe("CalendarGrid all-day band", () => {
	it("gives the week a band of its own, named", () => {
		assert.match(grid().innerHTML, /All day/);
	});

	it("draws an all-day event as a pill in the band, not a block in a slot", () => {
		const drawn = chip(grid({ events: [conference] }), "Conference");
		assert.equal(drawn.timed, false);
		assert.equal(drawn.date, TOMORROW);
	});

	it("gives an all-day event no clock, because it has none", () => {
		assert.equal(chip(grid({ events: [conference] }), "Conference").time, "");
	});
});

describe("CalendarGrid today", () => {
	it("marks the day the clock says, and only that day", () => {
		const root = grid();
		assert.ok(
			root.querySelector(`[data-date="${TODAY}"][aria-current="date"]`),
		);
		assert.equal(
			root.querySelector(`[data-date="${TOMORROW}"][aria-current="date"]`),
			null,
		);
	});

	it("tints today's lane with the accent rather than a colour of its own", () => {
		const lane = grid().querySelector<HTMLElement>(
			`[data-date="${TODAY}"][aria-current="date"]`,
		);
		assert.ok(lane);
		assert.ok(
			Array.from(
				grid().querySelectorAll<HTMLElement>(`[data-date="${TODAY}"]`),
			).some((cell) => cell.classList.contains("bg-accent-soft/40")),
		);
	});

	it("moves the marker with the clock it was handed", () => {
		const root = grid({ now: `${TOMORROW}T09:30:00+02:00` });
		assert.ok(
			root.querySelector(`[data-date="${TOMORROW}"][aria-current="date"]`),
		);
		assert.equal(
			root.querySelector(`[data-date="${TODAY}"][aria-current="date"]`),
			null,
		);
	});
});

describe("CalendarGrid empty", () => {
	it("still draws the week when nothing is booked in it", () => {
		const root = grid({ events: [] });
		assert.equal(chips(root).length, 0);
		assert.ok(root.querySelector(`[data-date="${TODAY}"]`));
	});

	it("says so in the agenda, where an empty list is otherwise a blank pane", () => {
		const status = grid({ view: "agenda", events: [] }).querySelector(
			"[role=status]",
		);
		assert.equal(status?.textContent, "Nothing scheduled");
	});
});

describe("CalendarGrid selection and state", () => {
	it("rings the selected event and leaves the rest alone", () => {
		const root = grid({
			events: [roadmap, dentist],
			selectedEventId: "dentist",
		});
		assert.ok(chip(root, "Dentist").classes.includes("ring-2"));
		assert.ok(!chip(root, "Roadmap review").classes.includes("ring-2"));
	});

	it("dims a declined event and strikes its title, the way the chip does", () => {
		const root = grid({
			events: [anEvent({ ...roadmap, myRsvp: "declined" })],
		});
		assert.ok(chip(root, "Roadmap review").classes.includes("opacity-60"));
		assert.match(root.innerHTML, /line-through/);
	});

	it("dashes a tentative event rather than recolouring it", () => {
		const root = grid({
			events: [anEvent({ ...roadmap, status: "tentative" })],
		});
		const drawn = chip(root, "Roadmap review");
		assert.ok(drawn.classes.includes("border-dashed"));
		assert.ok(drawn.classes.includes("bg-cal-3-soft"));
	});

	it("marks an event that came out of mail", () => {
		const root = grid({ events: [anEvent({ ...roadmap, threadId: "th_1" })] });
		assert.match(root.innerHTML, /From mail/);
	});

	it("flags an event whose zone the source never settled", () => {
		const root = grid({
			events: [anEvent({ ...roadmap, zoneCertainty: "ambiguous" })],
		});
		assert.match(root.innerHTML, /Unclear zone/);
	});
});

describe("CalendarGrid reach", () => {
	it("puts every event in the tab order and answers Enter on it", () => {
		const drawn = chips(grid({ events: [roadmap, dentist, conference] }));
		assert.equal(drawn.length, 3);
		assert.ok(drawn.every((one) => one.tabbable));
	});
});

describe("CalendarGrid density", () => {
	it("drops the time off a chip once the slots are halved", () => {
		const drawn = chip(
			grid({ events: [roadmap], density: "compact" }),
			"Roadmap review",
		);
		assert.equal(drawn.time, "");
		assert.equal(drawn.title, "Roadmap review");
	});
});
