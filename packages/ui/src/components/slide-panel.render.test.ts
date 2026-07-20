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

/** The panel element itself, as distinct from the scrim behind it. */
const dialog = (html: string): string => {
	const match = html.match(/<div[^>]*role="dialog"[^>]*>/);
	assert.ok(match, "no dialog element rendered");
	return match[0];
};

/** The click-to-dismiss scrim: the first element, before the dialog. */
const scrim = (html: string): string => {
	const match = html.match(/^<div[^>]*>/);
	assert.ok(match, "no scrim element rendered");
	return match[0];
};

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

	it("a closed panel is inert and hidden from assistive tech", () => {
		const tag = dialog(render(false));
		assert.match(tag, /inert=""/);
		assert.match(tag, /aria-hidden="true"/);
	});

	it("an open panel is reachable", () => {
		const tag = dialog(render(true));
		assert.doesNotMatch(tag, /inert=""/);
		assert.match(tag, /aria-hidden="false"/);
		assert.match(tag, /role="dialog"/);
	});

	it("scrolls its body rather than the page", () => {
		const html = render(true);
		assert.match(html, /overflow-auto/);
	});

	/**
	 * The scrim is a pointer shortcut for the header's Close button, not a
	 * control of its own: posing as a focusable button while answering only
	 * Escape strands a keyboard user on a thing that looks activatable.
	 */
	it("the scrim never poses as a focusable control", () => {
		for (const html of [render(true), render(false)]) {
			const tag = scrim(html);
			assert.doesNotMatch(tag, /role="button"/);
			assert.doesNotMatch(tag, /tabindex=/);
			assert.match(tag, /aria-hidden="true"/);
		}
	});

	it("always offers a labelled close control in the header", () => {
		assert.match(render(true), /aria-label="Close"/);
	});
});
