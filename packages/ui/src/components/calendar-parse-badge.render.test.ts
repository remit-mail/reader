import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	CalendarParseBadge,
	calendarParseLabel,
	calendarParseNote,
} from "./calendar-parse-badge.js";
import type { CalendarParseMethod } from "./calendar-types.js";

const methods: CalendarParseMethod[] = ["ics", "markup", "pattern"];

const render = (method: CalendarParseMethod) =>
	renderToString(createElement(CalendarParseBadge, { method }));

describe("CalendarParseBadge", () => {
	it("names the rung that answered", () => {
		for (const method of methods) {
			assert.match(render(method), new RegExp(calendarParseLabel[method]));
		}
	});

	it("marks a stated field apart from a reading of the prose", () => {
		assert.match(render("ics"), /text-positive/);
		assert.match(render("pattern"), /text-warning/);
	});

	it("carries a label and a note for every rung", () => {
		for (const method of methods) {
			assert.notEqual(calendarParseLabel[method], undefined, method);
			assert.notEqual(calendarParseNote[method], undefined, method);
		}
	});

	it("says a prose reading can be wrong, where a copied field does not", () => {
		assert.match(calendarParseNote.pattern, /can be wrong/);
		assert.doesNotMatch(calendarParseNote.ics, /can be wrong/);
	});
});
