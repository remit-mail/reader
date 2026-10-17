import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { ThreadRowData } from "./app-shell-types.js";
import { ComfortableRow } from "./message-row.js";

const base: ThreadRowData = {
	id: "t1",
	accountId: "a1",
	fromName: "Alex Rivera",
	fromEmail: "alex@example.com",
	subject: "Q3 planning notes",
	snippet: "Pushed the deck to the shared drive.",
	timeLabel: "9:42",
};

describe("ComfortableRow category presentation", () => {
	const render = (category: ThreadRowData["category"]): string =>
		renderToString(
			createElement(ComfortableRow, {
				thread: { ...base, isRead: true, category },
			}),
		);

	/** The category Badge's own class signature, so no other span matches. */
	const badgeClass = (html: string): string | undefined =>
		html.match(
			/class="([^"]*rounded-full px-2 py-0\.5 text-2xs font-medium[^"]*)"/,
		)?.[1];

	it("renders uncategorized as neither personal nor nothing (#45)", () => {
		const uncategorized = render("uncategorized");
		assert.notEqual(uncategorized, render("personal"));
		assert.ok(
			badgeClass(uncategorized),
			"a message the classifier has not reached carries its own badge",
		);
		assert.match(uncategorized, /uncategorized|unclassified/i);
	});
});

describe("ComfortableRow selection slot", () => {
	it("renders a checkbox reflecting the checked state", () => {
		const unchecked = renderToString(
			createElement(ComfortableRow, {
				thread: { ...base, isRead: true },
				selection: { checked: false, onToggle: () => undefined },
			}),
		);
		const checked = renderToString(
			createElement(ComfortableRow, {
				thread: { ...base, isRead: true },
				selection: { checked: true, onToggle: () => undefined },
			}),
		);
		assert.match(unchecked, /Select message/);
		assert.match(checked, /Deselect message/);
	});
});

describe("attachment indicator", () => {
	// A list row cannot download anything — the file lives on the message, which
	// is one pane over. So the paperclip here is metadata and says so, rather
	// than sitting inertly where a control belongs (#683).
	it("marks a comfortable row as carrying an attachment, without a control", () => {
		const html = renderToString(
			createElement(ComfortableRow, {
				thread: { ...base, isRead: true, hasAttachment: true },
			}),
		);
		assert.match(html, /role="img"/);
		assert.match(html, /aria-label="Has an attachment"/);
	});
});
