import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { SelectionTopBar } from "./selection-top-bar.js";

const handlers = {
	onCancel: () => undefined,
	onDelete: () => undefined,
};

/** SSR interleaves `<!-- -->` markers between interpolated text nodes; strip
 *  tags/comments so copy assertions match the rendered words. */
const text = (html: string) => html.replace(/<[^>]*>/g, "");

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

	it("renders cancel and delete controls", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 2 }),
		);
		assert.match(html, /aria-label="Cancel selection"/);
		assert.match(html, /aria-label="Delete selected messages"/);
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

	it("renders moveDisabledHint when provided", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 2,
				moveDisabledHint: "Cross-account moves are not supported",
			}),
		);
		assert.match(html, /Cross-account moves are not supported/);
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
		assert.doesNotMatch(text(html), /3412 messages selected/);
	});

	it("falls back to the count copy when statusLabel is absent", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 2 }),
		);
		assert.match(text(html), /2 messages selected/);
	});

	it("renders failureHint when provided", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 2,
				failureHint: "340 failed to delete — retry?",
			}),
		);
		assert.match(html, /340 failed to delete — retry\?/);
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

	it("omitting every new prop renders exactly the pre-existing bar", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 2 }),
		);
		assert.doesNotMatch(
			html,
			/aria-label="Select all"/,
			"no select-all control",
		);
		assert.match(text(html), /2 messages selected/, "default count copy");
		assert.doesNotMatch(html, /role="status"/, "no status line rendered");
	});
});
