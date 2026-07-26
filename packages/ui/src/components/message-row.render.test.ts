import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { ThreadRowData } from "./app-shell-types.js";
import { ComfortableRow, CompactRow } from "./message-row.js";

const base: ThreadRowData = {
	id: "t1",
	accountId: "a1",
	fromName: "Alex Rivera",
	fromEmail: "alex@example.com",
	subject: "Q3 planning notes",
	snippet: "Pushed the deck to the shared drive.",
	timeLabel: "9:42",
};

describe("ComfortableRow", () => {
	it("renders fromName, subject and snippet", () => {
		const html = renderToString(
			createElement(ComfortableRow, { thread: { ...base, isRead: true } }),
		);
		assert.match(html, /Alex Rivera/);
		assert.match(html, /Q3 planning notes/);
		assert.match(html, /Pushed the deck/);
	});

	it("renders unread styling differently from read", () => {
		const unread = renderToString(
			createElement(ComfortableRow, { thread: { ...base, isRead: false } }),
		);
		const read = renderToString(
			createElement(ComfortableRow, { thread: { ...base, isRead: true } }),
		);
		assert.notEqual(unread, read);
		assert.match(unread, /font-semibold/);
	});
});

describe("ComfortableRow category presentation", () => {
	const render = (category: ThreadRowData["category"]): string =>
		renderToString(
			createElement(ComfortableRow, {
				thread: { ...base, isRead: true, category },
			}),
		);

	it("renders no category marker for personal", () => {
		assert.doesNotMatch(render("personal"), /personal/i);
	});

	it("renders uncategorized as neither personal nor nothing (#45)", () => {
		const uncategorized = render("uncategorized");
		const personal = render("personal");
		assert.notEqual(uncategorized, personal);
		assert.doesNotMatch(uncategorized, /personal/i);
		assert.match(
			uncategorized,
			/uncategorized|unclassified/i,
			"a message the classifier has not reached carries its own marker",
		);
	});
});

describe("ComfortableRow selection slot", () => {
	it("renders no checkbox without a selection (non-selectable mode)", () => {
		const html = renderToString(
			createElement(ComfortableRow, { thread: { ...base, isRead: true } }),
		);
		assert.doesNotMatch(html, /Select message/);
	});

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

describe("CompactRow", () => {
	it("renders fromName and subject", () => {
		const html = renderToString(
			createElement(CompactRow, { thread: { ...base, isRead: true } }),
		);
		assert.match(html, /Alex Rivera/);
		assert.match(html, /Q3 planning notes/);
	});
});
