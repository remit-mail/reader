import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SlidePanel, type SlidePanelProps } from "./slide-panel.js";

const render = (isOpen: boolean) =>
	renderToStaticMarkup(
		createElement(
			SlidePanel,
			// createElement never folds the children argument into the props type,
			// so a component with required children needs the props cast.
			{
				isOpen,
				onClose: () => undefined,
				title: "Add Account",
			} as SlidePanelProps,
			"panel body",
		),
	);

describe("SlidePanel (#57)", () => {
	it("is a fixed right-edge column, never a full-viewport takeover above sm", () => {
		const html = render(true);
		assert.match(html, /fixed top-0 right-0/);
		assert.match(html, /sm:w-\[400px\]/);
		assert.match(html, /translate-x-0/);
	});

	it("a closed panel is off-canvas and takes no pointer events", () => {
		const html = render(false);
		assert.match(html, /translate-x-full/);
		assert.match(html, /pointer-events-none/);
	});

	it("a closed panel is out of the tab order and hidden from assistive tech", () => {
		const html = render(false);
		assert.match(html, /inert=""/);
		assert.match(html, /aria-hidden="true"/);
		assert.match(html, /tabindex="-1"/);
	});

	it("an open panel is reachable", () => {
		const html = render(true);
		assert.doesNotMatch(html, /inert=""/);
		assert.doesNotMatch(html, /aria-hidden="true"/);
		assert.match(html, /role="dialog"/);
	});

	it("scrolls its body rather than the page", () => {
		const html = render(true);
		assert.match(html, /overflow-auto/);
	});
});
