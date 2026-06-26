import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { ThreadData } from "./app-shell-types.js";
import { ReadingPane } from "./reading-pane.js";

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
