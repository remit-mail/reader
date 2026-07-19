import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MailActionToolbar } from "./mail-action-toolbar.js";

describe("MailActionToolbar", () => {
	it("renders the triage cluster by default (desktop reading-pane behavior)", () => {
		const html = renderToString(
			createElement(MailActionToolbar, { hasThread: true }),
		);
		assert.match(html, /aria-label="Reply"/);
		assert.match(html, /aria-label="Move to Trash"/);
		assert.match(html, /aria-label="Star"/);
		assert.match(html, /aria-label="Move to mailbox"/);
		// No archive verb — Remit is IMAP-backed (move-to-folder is the equivalent).
		assert.doesNotMatch(html, /aria-label="Archive"/);
	});

	it("hides the triage cluster when showTriage is false (mobile footer)", () => {
		const html = renderToString(
			createElement(MailActionToolbar, { hasThread: true, showTriage: false }),
		);
		// Reply verbs stay; triage is gone.
		assert.match(html, /aria-label="Reply"/);
		assert.match(html, /aria-label="Reply all"/);
		assert.match(html, /aria-label="Forward"/);
		assert.doesNotMatch(html, /aria-label="Archive"/);
		assert.doesNotMatch(html, /aria-label="Move to Trash"/);
		assert.doesNotMatch(html, /aria-label="Star"/);
		assert.doesNotMatch(html, /aria-label="Move to mailbox"/);
	});

	it("surfaces the unavailable hint when no thread is open", () => {
		const html = renderToString(
			createElement(MailActionToolbar, {
				hasThread: false,
				unavailableHint: "Open a message first",
			}),
		);
		assert.match(html, /Open a message first/);
	});
});
