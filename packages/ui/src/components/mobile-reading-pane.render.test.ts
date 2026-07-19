import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { ThreadData } from "./app-shell-types.js";
import type { IntelligenceData } from "./intelligence-panel.js";
import { MobileReadingPane } from "./mobile-reading-pane.js";

const thread: ThreadData = {
	subject: "Q3 planning notes",
	messages: [
		{
			id: "m1",
			fromName: "Alex Rivera",
			fromEmail: "alex@example.com",
			toLabel: "you",
			dateLabel: "Mon 9:42",
			snippet: "Here are the notes.",
			bodyHtml: "<p>Here are the notes.</p>",
		},
		{
			id: "m2",
			fromName: "Jamie Chen",
			fromEmail: "jamie@example.com",
			toLabel: "you",
			dateLabel: "Mon 11:15",
			snippet: "Thanks.",
			bodyHtml: "<p>Thanks.</p>",
		},
		{
			id: "m3",
			fromName: "Alex Rivera",
			fromEmail: "alex@example.com",
			toLabel: "you",
			dateLabel: "Tue 08:03",
			snippet: "One more thing.",
			bodyHtml: "<p>One more thing.</p>",
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
		summary: "Verified.",
	},
	category: { value: "Personal" },
	similar: [],
};

const countMatches = (html: string, needle: string) =>
	html.split(needle).length - 1;

describe("MobileReadingPane", () => {
	it("renders the top bar with back, subject and the intelligence toggle", () => {
		const html = renderToString(
			createElement(MobileReadingPane, {
				thread,
				intelligence,
				onBack: () => undefined,
			}),
		);
		assert.match(html, /aria-label="Back to messages"/);
		assert.match(html, /Q3 planning notes/);
		assert.match(html, /aria-label="Show intelligence panel"/);
	});

	it("omits the intelligence toggle when no intelligence is given", () => {
		const html = renderToString(
			createElement(MobileReadingPane, { thread, onBack: () => undefined }),
		);
		assert.doesNotMatch(html, /aria-label="Show intelligence panel"/);
	});

	it("shows exactly one per-message action bar — the expanded message's", () => {
		const html = renderToString(
			createElement(MobileReadingPane, { thread, onBack: () => undefined }),
		);
		// One expanded message ⇒ one Reply / Flag / Trash cluster; the two
		// collapsed rows carry no bar.
		assert.equal(countMatches(html, 'aria-label="Reply"'), 1);
		assert.equal(countMatches(html, 'aria-label="Star"'), 1);
		assert.equal(countMatches(html, 'aria-label="Move to Trash"'), 1);
	});

	it("has no thread-level reply footer (reply belongs to the message)", () => {
		// The desktop/legacy footer carries a "Reply (r)" title; the per-message
		// bar titles are plain "Reply". Assert the footer affordance is absent.
		const html = renderToString(
			createElement(MobileReadingPane, { thread, onBack: () => undefined }),
		);
		assert.doesNotMatch(html, /title="Reply \(r\)"/);
	});
});
