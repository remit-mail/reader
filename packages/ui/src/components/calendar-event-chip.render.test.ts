import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	CalendarEventChip,
	type CalendarEventChipProps,
} from "./calendar-event-chip.js";

const base: CalendarEventChipProps = {
	title: "Q3 roadmap review",
	timeText: "10:00",
	color: "cal-1",
	layout: "row",
	density: "comfortable",
	rsvp: "accepted",
	status: "confirmed",
	hasThread: false,
	isRecurring: false,
	zoneCertainty: "local",
	selected: false,
};

const render = (props: Partial<CalendarEventChipProps>) =>
	renderToString(createElement(CalendarEventChip, { ...base, ...props }));

describe("CalendarEventChip", () => {
	it("carries the calendar's hue and nothing else coloured", () => {
		const html = render({ color: "cal-3" });
		assert.match(html, /bg-cal-3-soft/);
		assert.match(html, /text-cal-3/);
	});

	it("renders the time ahead of the title", () => {
		const html = render({});
		assert.match(html, /10:00/);
		assert.match(html, /Q3 roadmap review/);
	});

	it("omits the time for an all-day entry", () => {
		const html = render({ timeText: "" });
		assert.doesNotMatch(html, /tabular-nums/);
	});

	it("strikes a declined event rather than recolouring it", () => {
		const html = render({ rsvp: "declined" });
		assert.match(html, /line-through/);
		assert.match(html, /bg-cal-1-soft/);
	});

	it("dashes the border of a tentative event", () => {
		const html = render({ status: "tentative" });
		assert.match(html, /border-dashed/);
	});

	it("marks an event that came from mail", () => {
		assert.match(render({ hasThread: true }), /From mail/);
	});

	it("marks a repeating event", () => {
		assert.match(render({ isRecurring: true }), /Repeats/);
	});

	it("flags a zone it could not determine", () => {
		assert.match(render({ zoneCertainty: "ambiguous" }), /Unclear zone/);
	});
});
