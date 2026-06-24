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

	it("renders the listBody slot instead of built-in rows when provided", () => {
		const html = renderToString(
			createElement(MessageListPane, {
				...baseProps,
				isDesktop: true,
				listBody: createElement(
					"div",
					{ "data-testid": "custom-body" },
					"virtualized rows here",
				),
			}),
		);
		// Custom body is rendered
		assert.match(html, /virtualized rows here/);
		// Built-in rows are NOT rendered when listBody is provided
		assert.doesNotMatch(html, /Q3 planning notes/);
	});

	it("honors the listBody slot on the touch path so mobile rows stay real anchors", () => {
		const html = renderToString(
			createElement(MessageListPane, {
				...baseProps,
				isDesktop: false,
				listState: "ready",
				listBody: createElement(
					"a",
					{ href: "/mail/inbox?selectedMessageId=t1" },
					"Q3 planning notes",
				),
			}),
		);
		// The consumer's anchor row is rendered on the mobile/touch path…
		assert.match(html, /href="\/mail\/inbox\?selectedMessageId=t1"/);
		// …and the built-in TouchListBody mock fallback is NOT substituted.
		assert.doesNotMatch(html, /Pull to refresh/);
	});

	it("surfaces the specific error message and a report path in the error state", () => {
		const html = renderToString(
			createElement(MessageListPane, {
				...baseProps,
				isDesktop: true,
				listState: "error",
				errorMessage: "IMAP connection timed out",
				onRetry: () => undefined,
				onReportError: () => undefined,
			}),
		);
		assert.match(html, /IMAP connection timed out/);
		assert.match(html, /Retry/);
		assert.match(html, /Report a problem/);
	});

	it("renders the selectionBar slot instead of the pane header when provided", () => {
		const html = renderToString(
			createElement(MessageListPane, {
				...baseProps,
				isDesktop: true,
				selectionBar: createElement("div", null, "2 selected"),
			}),
		);
		assert.match(html, /2 selected/);
		// The mailbox title header is NOT rendered when selectionBar is provided
		assert.doesNotMatch(html, /Inbox/);
	});
});
