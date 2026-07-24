import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AutoMovedBadge } from "./auto-moved-badge.js";

describe("AutoMovedBadge", () => {
	it("renders the label", () => {
		const html = renderToString(
			createElement(AutoMovedBadge, { label: "Moved from Junk by Remit" }),
		);
		assert.match(html, /Moved from Junk by Remit/);
	});

	it("renders no Undo action when onUndo is omitted", () => {
		const html = renderToString(
			createElement(AutoMovedBadge, { label: "Moved from Junk by Remit" }),
		);
		assert.doesNotMatch(html, /Undo/);
	});

	it("renders an Undo action when onUndo is provided", () => {
		const html = renderToString(
			createElement(AutoMovedBadge, {
				label: "Moved from Junk by Remit",
				onUndo: () => undefined,
			}),
		);
		assert.match(html, /Undo/);
	});

	it("renders a custom undo label", () => {
		const html = renderToString(
			createElement(AutoMovedBadge, {
				label: "Moved from Junk by Remit",
				onUndo: () => undefined,
				undoLabel: "Move back to Junk",
			}),
		);
		assert.match(html, /Move back to Junk/);
	});

	it("renders no filter link when filtersHref is omitted (classifier move)", () => {
		const html = renderToString(
			createElement(AutoMovedBadge, {
				label: "Moved from Junk by Remit",
				onUndo: () => undefined,
			}),
		);
		assert.doesNotMatch(html, /Manage filter/);
		assert.doesNotMatch(html, /settings\/filters/);
	});

	it("renders a Manage filter link to Settings when filtersHref is set", () => {
		const html = renderToString(
			createElement(AutoMovedBadge, {
				label: "Moved from Inbox by Remit",
				onUndo: () => undefined,
				filtersHref: "/settings/filters",
			}),
		);
		assert.match(html, /Manage filter/);
		assert.match(html, /href="\/settings\/filters"/);
	});
});
