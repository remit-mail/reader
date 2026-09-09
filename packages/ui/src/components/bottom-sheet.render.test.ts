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
				label: "Sheet",
				// biome-ignore lint/correctness/noChildrenProp: React 19 types require children in props object when using createElement
				children: "Sheet body",
			}),
		);
		assert.match(html, /Sheet body/);
		assert.match(html, /role="slider"/);
		assert.match(html, /Drag down to dismiss/);
	});

	it("takes the grabber out of the tab order, since it has no keyboard operation", () => {
		const html = renderToString(
			createElement(BottomSheet, {
				open: true,
				onClose: noop,
				label: "Sheet",
				// biome-ignore lint/correctness/noChildrenProp: React 19 types require children in props object when using createElement
				children: "Sheet body",
			}),
		);
		const grabber = html.match(/<div role="slider"[^>]*>/)?.[0] ?? "";
		assert.match(grabber, /tabindex="-1"/);
	});

	it("carries modal dialog semantics when open", () => {
		const html = renderToString(
			createElement(BottomSheet, {
				open: true,
				onClose: noop,
				label: "Sheet",
				// biome-ignore lint/correctness/noChildrenProp: React 19 types require children in props object when using createElement
				children: "Sheet body",
			}),
		);
		assert.match(html, /role="dialog"/);
		assert.match(html, /aria-modal="true"/);
		assert.doesNotMatch(html, /aria-hidden="true"/);
	});

	it("names itself for assistive tech from the label prop", () => {
		const html = renderToString(
			createElement(BottomSheet, {
				open: true,
				onClose: noop,
				label: "Rescue from spam",
				// biome-ignore lint/correctness/noChildrenProp: React 19 types require children in props object when using createElement
				children: "Sheet body",
			}),
		);
		assert.match(html, /aria-labelledby="bottom-sheet-title"/);
		assert.match(html, /id="bottom-sheet-title"[^>]*>Rescue from spam</);
	});

	it("goes inert and hides from assistive tech when closed", () => {
		const html = renderToString(
			createElement(BottomSheet, {
				open: false,
				onClose: noop,
				label: "Sheet",
				// biome-ignore lint/correctness/noChildrenProp: React 19 types require children in props object when using createElement
				children: "Sheet body",
			}),
		);
		assert.match(html, /role="dialog"/);
		assert.match(html, /aria-hidden="true"/);
		assert.match(html, /inert=""/);
	});

	it("uses the provided dismiss label on the scrim", () => {
		const html = renderToString(
			createElement(BottomSheet, {
				open: true,
				onClose: noop,
				label: "Sheet",
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
				label: "Sheet",
				// biome-ignore lint/correctness/noChildrenProp: React 19 types require children in props object when using createElement
				children: "x",
			}),
		);
		assert.match(html, /pointer-events-none/);
	});
});
