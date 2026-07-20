import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { SelectionTopBar } from "./selection-top-bar.js";

const handlers = {
	onCancel: () => undefined,
	onDelete: () => undefined,
};

/** SSR interleaves `<!-- -->` markers between interpolated text nodes and
 *  HTML-encodes entities; strip tags/comments and decode the handful of
 *  entities copy assertions actually hit, so they match the rendered words. */
const text = (html: string) =>
	html
		.replace(/<[^>]*>/g, "")
		.replace(/&quot;/g, '"')
		.replace(/&#x27;/g, "'")
		.replace(/&amp;/g, "&");

describe("SelectionTopBar", () => {
	it("renders singular copy for one message", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 1 }),
		);
		assert.match(text(html), /1 message selected/);
	});

	it("renders plural copy for many messages", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 3 }),
		);
		assert.match(text(html), /3 messages selected/);
	});

	it("applies thousands separators to the default count copy", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 3412 }),
		);
		assert.match(text(html), /3,412 messages selected/);
	});

	it("renders cancel and delete controls", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 2 }),
		);
		assert.match(html, /aria-label="Cancel selection"/);
		assert.match(html, /aria-label="Move selected messages to Trash"/);
	});

	it("renders cancel, mark-read and delete at the 44px touch size", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 2,
				onMarkRead: () => undefined,
			}),
		);
		const buttonCount = (html.match(/h-11 w-11/g) ?? []).length;
		assert.equal(buttonCount, 3, "cancel, mark-read and delete are all 44px");
	});

	it("spaces delete at least 16px from its preceding sibling", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 2 }),
		);
		assert.match(
			html,
			/class="[^"]*\bml-4\b[^"]*"[^>]*aria-label="Move selected messages to Trash"/,
		);
	});

	it("renders mark-read control when onMarkRead is provided", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 2,
				onMarkRead: () => undefined,
			}),
		);
		assert.match(html, /aria-label="Mark as read"/);
	});

	it("omits mark-read control when onMarkRead is absent", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 2 }),
		);
		assert.doesNotMatch(html, /aria-label="Mark as read"/);
	});

	it("hides mark-read while busy instead of disabling it", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 2,
				onMarkRead: () => undefined,
				isBusy: true,
			}),
		);
		assert.doesNotMatch(html, /aria-label="Mark as read"/);
	});

	it("hides delete while counting", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 0,
				isCounting: true,
			}),
		);
		assert.doesNotMatch(html, /aria-label="Move selected messages to Trash"/);
	});

	it("renders statusLabel in place of the count copy when provided", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 3412,
				statusLabel: "Deleting 1,200 of 3,412…",
			}),
		);
		assert.match(text(html), /Deleting 1,200 of 3,412…/);
		assert.doesNotMatch(text(html), /3,412 messages selected/);
	});

	it("falls back to the count copy when statusLabel is absent", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 2 }),
		);
		assert.match(text(html), /2 messages selected/);
	});

	it("marks the count/status line as a polite live region", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 2 }),
		);
		assert.match(
			html,
			/role="status"[^>]*aria-live="polite"[^>]*>2 messages selected/,
		);
	});

	it("omits the select-all control when selectAll is absent", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 2 }),
		);
		assert.doesNotMatch(html, /aria-label="Select all"/);
	});

	it("renders the select-all control, unchecked, in the some-selected state", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 2,
				selectAll: {
					checked: false,
					indeterminate: true,
					onChange: () => undefined,
				},
			}),
		);
		assert.match(html, /aria-label="Select all"/);
		assert.doesNotMatch(
			html,
			/aria-label="Select all"[^>]*checked=""/,
			"some-selected is not the checked state",
		);
	});

	it("renders the select-all control checked in the all-selected state", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 12,
				selectAll: {
					checked: true,
					indeterminate: false,
					onChange: () => undefined,
				},
			}),
		);
		assert.match(
			html,
			/aria-label="Select all"[^>]*checked=""/,
			"all-selected renders the checkbox checked",
		);
	});

	it("names the loaded scope by default once select-all is checked", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 47,
				selectAll: {
					checked: true,
					indeterminate: false,
					onChange: () => undefined,
				},
			}),
		);
		assert.match(text(html), /All 47 loaded selected/);
		assert.doesNotMatch(text(html), /^47 messages selected/);
	});

	it("lets statusLabel override the scoped default for an escalated selection", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 3412,
				selectAll: { checked: true, onChange: () => undefined },
				statusLabel: 'All 3,412 matching "npm" selected',
			}),
		);
		assert.match(text(html), /All 3,412 matching "npm" selected/);
	});

	it("gives the select-all checkbox a 44px hit area", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 2,
				selectAll: {
					checked: false,
					onChange: () => undefined,
				},
			}),
		);
		assert.match(html, /<label[^>]*size-11[^>]*>/);
	});

	it("renders the notice text and tone", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 2,
				notice: {
					tone: "warning",
					text: "Move only works within one account",
				},
			}),
		);
		assert.match(text(html), /Move only works within one account/);
		assert.match(html, /role="status"/);
	});

	it("renders the notice's action as a real button, not prose", () => {
		const onRetry = () => undefined;
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 340,
				notice: {
					tone: "danger",
					text: "3,072 moved to Trash. 340 couldn't be deleted.",
					action: { label: "Retry 340", onClick: onRetry },
				},
			}),
		);
		assert.match(html, /<button[^>]*>Retry 340<\/button>/);
	});

	it("omits the notice when absent", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 2 }),
		);
		// Only the count/status line carries role="status" — no second one for
		// an absent notice.
		const statusRoles = (html.match(/role="status"/g) ?? []).length;
		assert.equal(statusRoles, 1);
	});

	it("renders a determinate progress bar when progress is provided", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 3412,
				statusLabel: "Deleting 1,200 of 3,412…",
				isBusy: true,
				progress: { value: 1200, max: 3412 },
			}),
		);
		assert.match(html, /role="progressbar"/);
		assert.match(html, /aria-valuenow="1200"/);
	});

	it("omits the progress bar when progress is absent", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 2 }),
		);
		assert.doesNotMatch(html, /role="progressbar"/);
	});

	it("omitting every new prop renders exactly the pre-existing bar shape", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 2 }),
		);
		assert.doesNotMatch(
			html,
			/aria-label="Select all"/,
			"no select-all control",
		);
		assert.match(text(html), /2 messages selected/, "default count copy");
		assert.doesNotMatch(html, /role="progressbar"/, "no progress bar");
	});
});
