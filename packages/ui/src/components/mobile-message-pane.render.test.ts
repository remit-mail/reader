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
		assert.match(html, /aria-label="Back to messages"/);
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

	it("omits the header intelligence trigger when onInfo is provided (caller's managementBar carries it)", () => {
		// When onInfo is set the caller's management bar (e.g. MobileConversationTopBar)
		// already has a "Show intelligence panel" button; the kit header does not
		// duplicate it to avoid strict-mode duplicate-label violations.
		const html = renderToString(
			createElement(MobileMessagePane, {
				thread,
				onInfo: () => undefined,
				onBack: () => undefined,
			}),
		);
		assert.doesNotMatch(html, /aria-label="Show intelligence panel"/);
	});

	it("renders the managementBar slot", () => {
		const html = renderToString(
			createElement(MobileMessagePane, {
				thread,
				onBack: () => undefined,
				managementBar: createElement(
					"div",
					{ "data-testid": "mgmt-bar" },
					"Management",
				),
			}),
		);
		assert.match(html, /data-testid="mgmt-bar"/);
	});

	it("renders children instead of thread messages when children provided", () => {
		const html = renderToString(
			createElement(
				MobileMessagePane,
				{ onBack: () => undefined },
				createElement("div", { "data-testid": "live-message" }, "Live content"),
			),
		);
		assert.match(html, /data-testid="live-message"/);
		assert.doesNotMatch(html, /Q3 planning notes/);
	});

	it("renders composeSlot instead of MailActionToolbar when provided", () => {
		const html = renderToString(
			createElement(MobileMessagePane, {
				thread,
				onBack: () => undefined,
				composeSlot: createElement(
					"div",
					{ "data-testid": "compose-slot" },
					"Compose",
				),
			}),
		);
		assert.match(html, /data-testid="compose-slot"/);
		assert.doesNotMatch(html, /aria-label="Reply"/);
	});

	it("shows the Message details button in the toolbar when onInfo is provided", () => {
		const html = renderToString(
			createElement(MobileMessagePane, {
				thread,
				onInfo: () => undefined,
				onBack: () => undefined,
			}),
		);
		assert.match(html, /aria-label="Message details"/);
	});

	const countMatches = (html: string, needle: string) =>
		html.split(needle).length - 1;

	it("footer toolbar omits the triage cluster when a managementBar owns it", () => {
		// With a management bar present, the mobile footer toolbar must NOT render
		// archive / trash / flag — they live in the management bar. Reply verbs
		// still render. (The managementBar fixture here carries no triage buttons,
		// so the only triage would come from the footer — and must be absent.)
		const html = renderToString(
			createElement(MobileMessagePane, {
				thread,
				managementBar: createElement("div", { "data-testid": "mgmt" }),
				onReply: () => undefined,
				onBack: () => undefined,
			}),
		);
		assert.match(html, /aria-label="Reply"/);
		assert.doesNotMatch(html, /aria-label="Archive"/);
		assert.doesNotMatch(html, /aria-label="Move to Trash"/);
		assert.doesNotMatch(html, /aria-label="Flag"/);
	});

	it("footer toolbar keeps the triage cluster with no managementBar (kit reference)", () => {
		const html = renderToString(
			createElement(MobileMessagePane, {
				thread,
				onReply: () => undefined,
				onBack: () => undefined,
			}),
		);
		assert.match(html, /aria-label="Archive"/);
		assert.match(html, /aria-label="Move to Trash"/);
		assert.match(html, /aria-label="Flag"/);
	});

	it("renders exactly one Archive / Trash / Flag when the managementBar supplies them", () => {
		// Regression: the footer toolbar previously also rendered triage, so a
		// managementBar carrying the same three produced duplicate accessible
		// names (Playwright strict-mode failure).
		const managementBar = createElement(
			"div",
			null,
			createElement("button", { type: "button", "aria-label": "Archive" }),
			createElement("button", {
				type: "button",
				"aria-label": "Move to Trash",
			}),
			createElement("button", { type: "button", "aria-label": "Flag" }),
		);
		const html = renderToString(
			createElement(MobileMessagePane, {
				thread,
				managementBar,
				onReply: () => undefined,
				onBack: () => undefined,
			}),
		);
		assert.equal(countMatches(html, 'aria-label="Archive"'), 1);
		assert.equal(countMatches(html, 'aria-label="Move to Trash"'), 1);
		assert.equal(countMatches(html, 'aria-label="Flag"'), 1);
	});

	it("surfaces the SMTP hint and no-ops reply when canReply is false", () => {
		const html = renderToString(
			createElement(MobileMessagePane, {
				thread,
				onReply: () => undefined,
				canReply: false,
				replyUnavailableHint: "Configure SMTP to send mail",
				onBack: () => undefined,
			}),
		);
		assert.match(html, /Configure SMTP to send mail/);
	});
});
