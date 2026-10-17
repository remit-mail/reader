import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	CalendarSlotOffers,
	type CalendarSlotOffersProps,
} from "./calendar-slot-offers.js";
import type { CalendarSlotPick } from "./calendar-types.js";

const THURSDAY = "2026-06-11";

function slot(startTime: string, endTime: string): CalendarSlotPick {
	return {
		date: THURSDAY,
		endDate: THURSDAY,
		startTime,
		endTime,
		allDay: false,
	};
}

const thursday: CalendarSlotPick[] = [
	slot("10:45", "11:15"),
	slot("15:15", "15:45"),
];

const base: CalendarSlotOffersProps = {
	slots: thursday,
	picked: new Set<string>(),
	onToggle: () => undefined,
};

const render = (props: Partial<CalendarSlotOffersProps>) =>
	renderToString(createElement(CalendarSlotOffers, { ...base, ...props }));

describe("CalendarSlotOffers", () => {
	it("marks a picked slot as pressed rather than by colour alone", () => {
		const html = render({ picked: new Set(["15:15"]) });
		assert.match(html, /aria-pressed="true"/);
		assert.match(html, /aria-pressed="false"/);
	});

	it("says the day has nothing at this length rather than drawing an empty row", () => {
		const html = render({ slots: [] });
		assert.match(html, /Nothing free that day at this length/);
		assert.doesNotMatch(html, /<button/);
	});
});
