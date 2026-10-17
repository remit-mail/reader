import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { CalendarViewSwitch } from "./calendar-toolbar.js";

describe("CalendarViewSwitch", () => {
	it("marks the current view", () => {
		const html = renderToString(
			createElement(CalendarViewSwitch, {
				value: "day",
				onChange: () => undefined,
			}),
		);
		assert.match(html, /checked="" value="day"/);
	});
});
