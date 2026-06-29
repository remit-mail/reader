import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { BottomSheet } from "./bottom-sheet.js";

const noop = () => {};

describe("BottomSheet", () => {
	it("renders its children and a drag-to-dismiss grabber when open", () => {
		const html = renderToString(
			createElement(BottomSheet, {
				open: true,
				onClose: noop,
				// biome-ignore lint/correctness/noChildrenProp: React 19 types require children in props object when using createElement
				children: "Sheet body",
			}),
		);
		assert.match(html, /Sheet body/);
		assert.match(html, /role="slider"/);
		assert.match(html, /Drag down to dismiss/);
	});

	it("uses the provided dismiss label on the scrim", () => {
		const html = renderToString(
			createElement(BottomSheet, {
				open: true,
				onClose: noop,
				dismissLabel: "Close rescue",
				// biome-ignore lint/correctness/noChildrenProp: React 19 types require children in props object when using createElement
				children: "x",
			}),
		);
		assert.match(html, /aria-label="Close rescue"/);
	});

	it("renders translated off-screen when closed", () => {
		const html = renderToString(
			createElement(BottomSheet, {
				open: false,
				onClose: noop,
				// biome-ignore lint/correctness/noChildrenProp: React 19 types require children in props object when using createElement
				children: "x",
			}),
		);
		assert.match(html, /pointer-events-none/);
	});
});
