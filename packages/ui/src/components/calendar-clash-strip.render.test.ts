import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { CalendarClashStrip } from "./calendar-clash-strip.js";
import type { CalendarClash } from "./calendar-types.js";

const dentist: CalendarClash = {
	id: "evt_dentist",
	label: "Dentist · 14:30 – 15:15 · Personal (matthijs@)",
};

const planning: CalendarClash = {
	id: "evt_planning",
	label: "Sprint planning · 14:00 – 15:00 · Work (work@)",
};

const render = (clashes: CalendarClash[], clearText?: string) =>
	renderToString(createElement(CalendarClashStrip, { clashes, clearText }));

describe("CalendarClashStrip", () => {
	it("says the span is clear rather than rendering nothing", () => {
		const html = render([]);
		assert.match(html, /Nothing else is booked over it/);
		assert.match(html, /text-positive/);
	});

	it("takes the caller's words for the clear case", () => {
		assert.match(
			render([], "Thursday afternoon is empty from 15:15."),
			/empty from 15:15/,
		);
	});

	it("names every clash, with the calendar it came from", () => {
		const html = render([dentist, planning]);
		assert.match(html, /Dentist/);
		assert.match(html, /Sprint planning/);
		assert.match(html, /Personal \(matthijs@\)/);
	});

	it("counts the collisions rather than leaving the tally to the eye", () => {
		assert.match(render([dentist]), /clashes with something/);
		assert.match(render([dentist, planning]), /clashes with 2 things/);
	});

	it("draws a collision as danger and a clear span as neither", () => {
		assert.match(render([dentist]), /bg-danger-soft/);
		assert.doesNotMatch(render([]), /danger/);
	});
});
