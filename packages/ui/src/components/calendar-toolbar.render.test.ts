import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { CalendarDateNav, CalendarViewSwitch } from "./calendar-toolbar.js";

describe("CalendarViewSwitch", () => {
	it("offers the whole ladder by default", () => {
		const html = renderToString(
			createElement(CalendarViewSwitch, {
				value: "week",
				onChange: () => undefined,
			}),
		);
		for (const label of ["Year", "Month", "Week", "Day", "Agenda"]) {
			assert.match(html, new RegExp(label));
		}
	});

	it("marks the current view", () => {
		const html = renderToString(
			createElement(CalendarViewSwitch, {
				value: "day",
				onChange: () => undefined,
			}),
		);
		assert.match(html, /checked="" value="day"/);
	});

	it("narrows the ladder and shortens the labels for a thumb", () => {
		const html = renderToString(
			createElement(CalendarViewSwitch, {
				value: "day",
				onChange: () => undefined,
				views: ["day", "agenda"],
				touch: true,
			}),
		);
		assert.doesNotMatch(html, /Year/);
		assert.match(html, /min-h-11/);
	});

	it("marks the current view flat, without a raised surface", () => {
		const html = renderToString(
			createElement(CalendarViewSwitch, {
				value: "week",
				onChange: () => undefined,
			}),
		);
		assert.match(html, /bg-accent-2-soft/);
		assert.doesNotMatch(html, /shadow-sm/);
	});
});

describe("CalendarDateNav", () => {
	it("puts Today beside the range it returns to", () => {
		const html = renderToString(
			createElement(CalendarDateNav, {
				title: "8 – 14 June 2026",
				onPrev: () => undefined,
				onNext: () => undefined,
				onToday: () => undefined,
			}),
		);
		assert.match(html, /Today/);
		assert.match(html, /8 – 14 June 2026/);
		assert.match(html, /aria-label="Previous"/);
	});
});
