import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { ThreadSection } from "./app-shell-types.js";
import { TouchListBody } from "./touch-list.js";

const sections: ThreadSection[] = [
	{
		id: "today",
		label: "Today",
		threads: [
			{
				id: "t1",
				accountId: "a1",
				fromName: "Priya Nair",
				fromEmail: "priya@example.com",
				subject: "Design review tomorrow",
				snippet: "Can we move it to 2pm?",
				timeLabel: "8:15",
				isRead: false,
			},
			{
				id: "t2",
				accountId: "a1",
				fromName: "Alex Rivera",
				fromEmail: "alex@example.com",
				subject: "Q3 planning notes",
				snippet: "Pushed the deck.",
				timeLabel: "9:42",
				isRead: true,
			},
		],
	},
];

const baseProps = {
	sections,
	selectionMode: false,
	checkedIds: new Set<string>(),
	refreshing: false,
	onToggleCheck: () => undefined,
	onEnterSelection: () => undefined,
	onOpenThread: () => undefined,
	onRefresh: () => undefined,
};

describe("TouchListBody", () => {
	it("renders the rows", () => {
		const html = renderToString(createElement(TouchListBody, baseProps));
		assert.match(html, /Priya Nair/);
		assert.match(html, /Alex Rivera/);
	});

	it("shows the refreshing affordance when refreshing", () => {
		const html = renderToString(
			createElement(TouchListBody, { ...baseProps, refreshing: true }),
		);
		assert.match(html, /Checking for new mail/);
	});

	it("shows pull to refresh when idle and not in selection mode", () => {
		const html = renderToString(createElement(TouchListBody, baseProps));
		assert.match(html, /Pull to refresh/);
	});

	it("dims and suppresses taps on every row while busy", () => {
		const html = renderToString(
			createElement(TouchListBody, {
				...baseProps,
				selectionMode: true,
				checkedIds: new Set(["t1", "t2"]),
				busy: true,
			}),
		);
		const dimmed = (html.match(/pointer-events-none opacity-50/g) ?? []).length;
		assert.equal(dimmed, 2, "both seeded rows are dimmed");
	});

	it("hides pull to refresh while busy", () => {
		const html = renderToString(
			createElement(TouchListBody, { ...baseProps, busy: true }),
		);
		assert.doesNotMatch(html, /Pull to refresh/);
	});

	it("renders rows undimmed when not busy", () => {
		const html = renderToString(createElement(TouchListBody, baseProps));
		assert.doesNotMatch(html, /pointer-events-none/);
	});
});
