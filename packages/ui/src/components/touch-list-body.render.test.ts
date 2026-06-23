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
});
