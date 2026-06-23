import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { ThreadSection } from "./app-shell-types.js";
import { MessageListPane } from "./message-list-pane.js";

const sections: ThreadSection[] = [
	{
		id: "today",
		label: "Today",
		threads: [
			{
				id: "t1",
				accountId: "a1",
				fromName: "Alex Rivera",
				fromEmail: "alex@example.com",
				subject: "Q3 planning notes",
				snippet: "Here are the notes from today's planning session.",
				timeLabel: "9:42",
			},
			{
				id: "t2",
				accountId: "a1",
				fromName: "Acme Billing",
				fromEmail: "billing@acme.com",
				subject: "Your invoice is ready",
				snippet: "Invoice #1042 is available to view.",
				timeLabel: "8:15",
			},
		],
	},
];

const baseProps = {
	listTitle: "Inbox",
	sections,
	flatList: true,
	onSelectThread: () => undefined,
	onSelectBriefCategory: () => undefined,
};

describe("MessageListPane", () => {
	it("renders the list title and the rows", () => {
		const html = renderToString(
			createElement(MessageListPane, { ...baseProps, isDesktop: true }),
		);
		assert.match(html, /Inbox/);
		assert.match(html, /Q3 planning notes/);
		assert.match(html, /Your invoice is ready/);
	});

	it("shows the pull-to-refresh affordance on the narrow touch list", () => {
		const html = renderToString(
			createElement(MessageListPane, {
				...baseProps,
				isDesktop: false,
				listState: "ready",
			}),
		);
		assert.match(html, /Pull to refresh/);
	});

	it("omits the pull-to-refresh affordance on the desktop list", () => {
		const html = renderToString(
			createElement(MessageListPane, { ...baseProps, isDesktop: true }),
		);
		assert.doesNotMatch(html, /Pull to refresh/);
	});
});
