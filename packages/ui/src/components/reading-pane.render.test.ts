import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { ThreadData, ThreadMessageData } from "./app-shell-types.js";
import {
	CollapsedMessage,
	ExpandedMessage,
	ReadingPane,
} from "./reading-pane.js";

const message: ThreadMessageData = {
	id: "m-1",
	fromName: "Jamie Chen",
	fromEmail: "jamie@example.com",
	toLabel: "Alex Rivera, you",
	dateLabel: "Today, 09:11",
	snippet: "Circulating the deck this afternoon.",
	bodyHtml: "<p>body</p>",
};

const thread: ThreadData = {
	subject: "Q3 planning notes",
	messages: [
		{
			id: "msg-1",
			fromName: "Alex Rivera",
			fromEmail: "alex@example.com",
			toLabel: "you",
			dateLabel: "Today, 09:11",
			snippet: "Here's where we landed after the call.",
			bodyHtml: "<p>The roadmap stands and the budget is locked.</p>",
			expanded: true,
		},
	],
};

describe("ReadingPane", () => {
	it("renders the subject and the expanded message header with a thread", () => {
		const html = renderToString(createElement(ReadingPane, { thread }));
		assert.match(html, /Q3 planning notes/);
		// The email body now renders through the kit's sanitize → sandboxed
		// IsolatedEmailFrame pipeline (#940), which needs a DOM and so emits no
		// body text under SSR. Assert the expanded message's sender header
		// instead; body rendering is covered by the sanitizer + MessageBodyView
		// tests.
		assert.match(html, /Alex Rivera/);
	});

	it("renders the empty state with no thread", () => {
		const html = renderToString(createElement(ReadingPane, {}));
		assert.doesNotMatch(html, /Q3 planning notes/);
		assert.match(html, /Select a thread to read/);
	});

	it("renders the toolbar with the search input", () => {
		const html = renderToString(createElement(ReadingPane, { thread }));
		assert.match(html, /Search mail/);
	});
});

describe("CollapsedMessage row slots (#945)", () => {
	it("renders the fixture date label when no trailing slot is given", () => {
		const html = renderToString(createElement(CollapsedMessage, { message }));
		assert.match(html, /Today, 09:11/);
		assert.match(html, /Jamie Chen/);
	});

	it("renders the app's trailing cluster instead of the date label", () => {
		const html = renderToString(
			createElement(CollapsedMessage, {
				message,
				trailing: createElement("span", null, "STAR-DATE-SLOT"),
			}),
		);
		assert.match(html, /STAR-DATE-SLOT/);
		assert.doesNotMatch(html, /Today, 09:11/);
	});

	it("shows the unread dot and bolds the sender when isUnread", () => {
		const html = renderToString(
			createElement(CollapsedMessage, { message, isUnread: true }),
		);
		assert.match(html, /font-semibold/);
	});
});

describe("ExpandedMessage row slots (#945)", () => {
	it("injects the app body slot instead of the fixture MessageBodyView", () => {
		const html = renderToString(
			createElement(ExpandedMessage, {
				message,
				body: createElement("div", null, "REAL-MESSAGE-BODY"),
			}),
		);
		assert.match(html, /REAL-MESSAGE-BODY/);
	});

	it("renders the sender badge, action menu and recipient slots", () => {
		const html = renderToString(
			createElement(ExpandedMessage, {
				message,
				senderBadge: createElement("span", null, "BADGE"),
				actionMenu: createElement("span", null, "ACTION-MENU"),
				to: createElement("span", null, "TO-LINE"),
			}),
		);
		assert.match(html, /BADGE/);
		assert.match(html, /ACTION-MENU/);
		assert.match(html, /TO-LINE/);
	});

	it("hides the recipient line when `to` is null", () => {
		const html = renderToString(
			createElement(ExpandedMessage, { message, to: null }),
		);
		assert.doesNotMatch(html, /to Alex Rivera/);
	});
});
