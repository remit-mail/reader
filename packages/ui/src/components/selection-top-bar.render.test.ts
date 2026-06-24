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
});
