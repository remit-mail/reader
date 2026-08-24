/**
 * AboveScrim (#747) — the control that opened a modal surface, kept pressable
 * while that surface's scrim covers the toolbar it lives in.
 *
 * Mounted against jsdom: what this component does is move one element between
 * two parents, which is a fact about the tree rather than about markup.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AboveScrim, useScrimElevationLayer } from "./above-scrim.js";

let container: HTMLElement;
let root: Root;

function Fixture({ up, elevated }: { up: boolean; elevated: boolean }) {
	const layerRef = useScrimElevationLayer();
	return createElement(
		Fragment,
		null,
		createElement(
			"header",
			{ "data-toolbar": "" },
			createElement(
				AboveScrim,
				{ elevated },
				createElement("button", { type: "button", "data-name": "info" }),
			),
		),
		up
			? createElement(
					"div",
					{ "data-modal": "" },
					createElement("button", { type: "button", "data-name": "scrim" }),
					createElement("div", { ref: layerRef, "data-layer": "" }),
					createElement("div", { "data-panel": "" }),
				)
			: null,
	);
}

const show = (up: boolean, elevated: boolean): void => {
	act(() => {
		root.render(createElement(Fixture, { up, elevated }));
	});
};

const control = (): HTMLElement => {
	const found = container.querySelector<HTMLElement>('[data-name="info"]');
	if (!found) throw new Error("expected the control");
	return found;
};

const layer = (): HTMLElement => {
	const found = container.querySelector<HTMLElement>("[data-layer]");
	if (!found) throw new Error("expected the elevation layer");
	return found;
};

beforeEach(() => {
	container = document.getElementById("root") as unknown as HTMLElement;
	container.innerHTML = "";
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
});

describe("AboveScrim", () => {
	it("leaves the control in its toolbar while nothing is up", () => {
		show(false, false);
		assert.ok(control().closest("[data-toolbar]"));
	});

	it("moves it onto the layer once the surface is up", () => {
		show(false, true);
		show(true, true);
		assert.equal(control().closest("[data-layer]"), layer());
	});

	it("leaves a control that did not open the surface where it is", () => {
		show(false, false);
		show(true, false);
		assert.ok(control().closest("[data-toolbar]"));
	});

	it("brings it home when the surface goes down", () => {
		show(false, true);
		show(true, true);
		show(false, true);
		assert.ok(control().closest("[data-toolbar]"));
	});

	it("keeps the same element across the move, focus included", () => {
		show(false, true);
		const before = control();
		before.focus();

		show(true, true);

		assert.equal(control(), before);
		assert.equal(document.activeElement, before);
	});

	it("holds the toolbar's slot open so nothing reflows into the gap", () => {
		show(false, true);
		show(true, true);
		const slot = container.querySelector<HTMLElement>("[data-toolbar] span");
		assert.ok(slot);
		assert.notEqual(slot.style.width, "");
		assert.notEqual(slot.style.height, "");
	});
});
