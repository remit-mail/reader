import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { CalendarList } from "./calendar-list.js";
import type { CalendarDescriptor } from "./calendar-types.js";

const calendars: CalendarDescriptor[] = [
	{
		id: "c1",
		accountId: "a1",
		accountLabel: "Work",
		name: "Northwind",
		color: "cal-1",
	},
	{
		id: "c2",
		accountId: "a1",
		accountLabel: "Work",
		name: "On-call",
		color: "cal-4",
	},
	{
		id: "c3",
		accountId: "a2",
		accountLabel: "Personal",
		name: "Family",
		color: "cal-3",
	},
];

const render = (
	visible: string[],
	withAccountToggle = false,
	closedAccountIds?: string[],
) =>
	renderToString(
		createElement(CalendarList, {
			calendars,
			visible: new Set(visible),
			onToggle: () => undefined,
			...(withAccountToggle ? { onToggleAccount: () => undefined } : {}),
			...(closedAccountIds ? { closedAccountIds } : {}),
		}),
	);

describe("CalendarList", () => {
	it("groups calendars under the account that owns them", () => {
		const html = render(["c1"]);
		assert.match(html, /Work/);
		assert.match(html, /Personal/);
		assert.match(html, /Northwind/);
	});

	it("fills the swatch of a visible calendar and outlines a hidden one", () => {
		const html = render(["c1"]);
		assert.match(html, /bg-cal-1/);
		assert.match(html, /bg-transparent/);
	});

	it("offers an all-or-none control per account only when asked", () => {
		assert.doesNotMatch(render(["c1"]), />None</);
		assert.match(render(["c1", "c2"], true), />None</);
	});

	it("offers 'All' when an account is fully hidden", () => {
		assert.match(render([], true), />All</);
	});

	it("folds an account's rows away behind its caret, keeping the heading", () => {
		const html = render(["c1", "c2", "c3"], true, ["a1"]);
		assert.match(html, /aria-expanded="false"/);
		assert.match(html, /Work/);
		assert.doesNotMatch(html, /Northwind/);
		assert.match(html, /Family/);
	});
});

/**
 * A provider calendar whose account has calendar sync off. Nothing was deleted,
 * so the row stays, its tick keeps drawing the stored events, and the pause is
 * a label on the row (#1179).
 */
describe("CalendarList with a paused calendar", () => {
	const paused: CalendarDescriptor[] = calendars.map((calendar) =>
		calendar.id === "c1" ? { ...calendar, sync: "paused" } : calendar,
	);

	const renderPaused = (visible: string[]) =>
		renderToString(
			createElement(CalendarList, {
				calendars: paused,
				visible: new Set(visible),
				onToggle: () => undefined,
			}),
		);

	it("keeps the row and labels the pause", () => {
		const html = renderPaused(["c1"]);
		assert.match(html, /Northwind/);
		assert.match(html, /calendar sync off/);
	});

	it("leaves a live calendar unlabelled", () => {
		assert.doesNotMatch(render(["c1"]), /calendar sync off/);
	});

	it("keeps a paused calendar tickable, so its events stay drawable", () => {
		assert.match(renderPaused(["c1"]), /checked=""/);
	});
});
