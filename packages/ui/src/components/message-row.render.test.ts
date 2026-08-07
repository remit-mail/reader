import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { categoryTone, type ThreadRowData } from "./app-shell-types.js";
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

	it("renders a chip for every label applied to the message (issue #26)", () => {
		const html = renderToString(
			createElement(ComfortableRow, {
				thread: {
					...base,
					isRead: true,
					labels: [
						{ labelId: "l1", name: "Receipts", color: "Blue" },
						{ labelId: "l2", name: "Travel", color: "Green" },
					],
				},
			}),
		);
		assert.match(html, /Receipts/);
		assert.match(html, /Travel/);
	});

	it("renders no label chip when the message carries none", () => {
		const html = renderToString(
			createElement(ComfortableRow, { thread: { ...base, isRead: true } }),
		);
		assert.doesNotMatch(html, /Remove label/);
	});
});

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

	it("renders no category badge for personal", () => {
		assert.equal(badgeClass(render("personal")), undefined);
	});

	it("renders uncategorized as neither personal nor nothing (#45)", () => {
		const uncategorized = render("uncategorized");
		assert.notEqual(uncategorized, render("personal"));
		assert.ok(
			badgeClass(uncategorized),
			"a message the classifier has not reached carries its own badge",
		);
		assert.match(uncategorized, /uncategorized|unclassified/i);
	});

	it("keeps the uncategorized badge off personal's tone (#45)", () => {
		assert.notEqual(
			categoryTone.uncategorized,
			categoryTone.personal,
			"the tone table must not give unclassified mail personal's colour",
		);
		assert.doesNotMatch(
			badgeClass(render("uncategorized")) ?? "",
			/accent/,
			"the row badge must not render personal's accent tone",
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

	it("marks a compact row as carrying an attachment", () => {
		const html = renderToString(
			createElement(CompactRow, {
				thread: { ...base, isRead: true, hasAttachment: true },
			}),
		);
		assert.match(html, /aria-label="Has an attachment"/);
	});

	it("renders no indicator when the message carries nothing", () => {
		const html = renderToString(
			createElement(ComfortableRow, { thread: { ...base, isRead: true } }),
		);
		assert.doesNotMatch(html, /Has an attachment/);
	});
});
