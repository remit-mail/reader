import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { SelectionSheet, type SelectionSheetProps } from "./selection-sheet.js";

const noop = () => {};

const base: SelectionSheetProps = {
	count: 3,
	onCancel: noop,
	onDelete: noop,
};

describe("SelectionSheet", () => {
	it("teases collapsed with the count and the swipe hint", () => {
		const html = renderToString(createElement(SelectionSheet, base));
		assert.match(html, /3 messages selected/);
		assert.match(html, /Swipe up for actions/);
		assert.match(html, /role="slider"/);
		// Collapsed: no cancel/mark-read in the header yet.
		assert.doesNotMatch(html, /aria-label="Cancel selection"/);
		// The clipped body is inert while collapsed, so its offscreen verbs stay
		// out of the tab order and the a11y tree.
		assert.match(html, /inert=""/);
	});

	it("expanded shows the quick actions, cancel, and the smart-flow rows", () => {
		const html = renderToString(
			createElement(SelectionSheet, {
				...base,
				startExpanded: true,
				onMarkRead: noop,
				onJunk: noop,
				onSelectSimilar: noop,
				onSomethingElse: noop,
				moveSlot: createElement("span", null, "move-here"),
			}),
		);
		assert.match(html, /aria-label="Move selected messages to Trash"/);
		assert.match(html, /aria-label="Move selected messages to Junk"/);
		assert.match(html, /aria-label="Mark as read"/);
		assert.match(html, /aria-label="Cancel selection"/);
		assert.match(html, /move-here/);
		assert.match(html, /Select similar messages/);
		assert.match(html, /Something else/);
		// Expanded: the body is live, not inert.
		assert.doesNotMatch(html, /inert=""/);
	});

	it("names the loaded scope and renders the select-all control", () => {
		const html = renderToString(
			createElement(SelectionSheet, {
				...base,
				count: 47,
				startExpanded: true,
				selectAll: { checked: true, indeterminate: false, onChange: noop },
			}),
		);
		assert.match(html, /All 47 loaded selected/);
		assert.match(html, /aria-label="Select all"/);
	});

	it("counting replaces the quick actions with the status and a Stop", () => {
		const html = renderToString(
			createElement(SelectionSheet, {
				...base,
				count: 0,
				mode: "counting",
				statusLabel: "Counting… 1,900 so far",
				notice: {
					tone: "info",
					text: "",
					action: { label: "Stop", onClick: noop },
				},
			}),
		);
		assert.match(html, /Counting… 1,900 so far/);
		assert.match(html, /Stop/);
		// No quick actions while counting.
		assert.doesNotMatch(html, /aria-label="Move selected messages to Trash"/);
	});

	it("running shows a progress bar and no quick actions", () => {
		const html = renderToString(
			createElement(SelectionSheet, {
				...base,
				count: 3412,
				mode: "running",
				isBusy: true,
				statusLabel: "Deleting 1,200 of 3,412…",
				progress: { value: 1200, max: 3412 },
			}),
		);
		assert.match(html, /Deleting 1,200 of 3,412…/);
		assert.match(html, /role="progressbar"/);
		assert.doesNotMatch(html, /Select similar messages/);
	});

	it("escalated keeps the verbs and a clear-selection notice", () => {
		const html = renderToString(
			createElement(SelectionSheet, {
				...base,
				count: 3412,
				mode: "escalated",
				startExpanded: true,
				statusLabel: 'All 3,412 matching "npm" selected',
				moveSlot: createElement("span", null, "move-here"),
				notice: {
					tone: "info",
					text: "",
					action: { label: "Clear selection", onClick: noop },
				},
			}),
		);
		assert.match(html, /All 3,412 matching/);
		assert.match(html, /aria-label="Move selected messages to Trash"/);
		assert.match(html, /Clear selection/);
		// Not a bounded selection, so no select-similar entry.
		assert.doesNotMatch(html, /Select similar messages/);
	});

	it("renders a partial-failure notice with a Retry action", () => {
		const html = renderToString(
			createElement(SelectionSheet, {
				...base,
				count: 340,
				startExpanded: true,
				notice: {
					tone: "danger",
					text: "3,072 moved to Trash. 340 couldn't be deleted.",
					action: { label: "Retry 340", onClick: noop },
				},
			}),
		);
		assert.match(html, /3,072 moved to Trash/);
		assert.match(html, /Retry 340/);
	});
});
