import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { ThreadData } from "./app-shell-types.js";
import type { IntelligenceData } from "./intelligence-panel.js";
import { MobileMessagePane } from "./mobile-message-pane.js";

const thread: ThreadData = {
	subject: "Q3 planning notes",
	messages: [
		{
			id: "m1",
			fromName: "Alex Rivera",
			fromEmail: "alex@example.com",
			toLabel: "you",
			dateLabel: "9:42",
			snippet: "Here are the notes from today's planning session.",
			bodyHtml: "<p>Body of the planning message goes here.</p>",
			expanded: true,
		},
	],
};

const intelligence: IntelligenceData = {
	sender: {
		name: "Alex Rivera",
		email: "alex@example.com",
		trust: "wellknown",
		firstSeenLabel: "Jan 2025",
	},
	authenticity: {
		verdict: "aligned",
		fromDomain: "example.com",
		summary: "DKIM signature aligns with the sending domain.",
	},
	category: { value: "Personal" },
	similar: [],
};

describe("MobileMessagePane", () => {
	it("renders the subject, body and the back button", () => {
		const html = renderToString(
			createElement(MobileMessagePane, { thread, onBack: () => undefined }),
		);
		assert.match(html, /Q3 planning notes/);
		assert.match(html, /Body of the planning message goes here/);
		assert.match(html, /aria-label="Back to list"/);
	});

	it("shows the intelligence trigger when intelligence is present", () => {
		const html = renderToString(
			createElement(MobileMessagePane, {
				thread,
				intelligence,
				onBack: () => undefined,
			}),
		);
		assert.match(html, /aria-label="Show intelligence panel"/);
	});

	it("omits the intelligence trigger when there is no intelligence", () => {
		const html = renderToString(
			createElement(MobileMessagePane, { thread, onBack: () => undefined }),
		);
		assert.doesNotMatch(html, /aria-label="Show intelligence panel"/);
	});
});
