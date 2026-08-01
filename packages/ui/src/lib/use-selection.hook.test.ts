/**
 * The hook itself, driven on a mounted component: the pure helpers are covered
 * in `use-selection.test.ts`, and what is left is the state each verb leaves
 * behind — what a toggle does to the anchor, what a refresh narrows away, what
 * a second shift-range extends from.
 */

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSelection } from "./use-selection.js";

let dom: JSDOM;
let container: HTMLElement;
let root: Root;
let api: ReturnType<typeof useSelection>;

function Harness() {
	api = useSelection();
	return createElement("div", { id: "harness" });
}

const mount = () => {
	act(() => {
		root.render(createElement(Harness));
	});
};

const run = (fn: () => void) => {
	act(fn);
};

const selected = () => Array.from(api.selectedIds);

before(async () => {
	const { JSDOM: JSDOMCtor } = await import("jsdom");
	dom = new JSDOMCtor(
		"<!doctype html><html><body><div id=root></div></body></html>",
		{ url: "http://localhost/", pretendToBeVisual: true },
	);
	globalThis.window = dom.window as unknown as typeof globalThis.window;
	globalThis.document = dom.window.document;
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.Element = dom.window.Element;
	globalThis.SVGElement = dom.window.SVGElement;
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

after(() => {
	dom.window.close();
});

beforeEach(() => {
	container = dom.window.document.getElementById(
		"root",
	) as unknown as HTMLElement;
	container.innerHTML = "";
	root = createRoot(container);
	mount();
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
});

const ids = ["a", "b", "c", "d"];

describe("useSelection", () => {
	it("starts empty", () => {
		assert.deepEqual(selected(), []);
		assert.equal(api.selectedCount, 0);
		assert.equal(api.hasSelection, false);
		assert.equal(api.anchorId, undefined);
	});

	it("toggles a row on and off, anchoring on it either way", () => {
		run(() => api.toggle("b"));
		assert.deepEqual(selected(), ["b"]);
		assert.equal(api.isSelected("b"), true);
		assert.equal(api.anchorId, "b");

		run(() => api.toggle("b"));
		assert.deepEqual(selected(), []);
		assert.equal(api.anchorId, "b");
	});

	it("selects and deselects a single row", () => {
		run(() => api.select("a"));
		run(() => api.select("a"));
		assert.deepEqual(selected(), ["a"]);

		run(() => api.deselect("a"));
		assert.deepEqual(selected(), []);
		run(() => api.deselect("a"));
		assert.deepEqual(selected(), []);
	});

	it("selects every row, then clears the selection and the anchor", () => {
		run(() => api.select("a"));
		run(() => api.selectAll(ids));
		assert.deepEqual(selected(), ids);
		assert.equal(api.hasSelection, true);

		run(() => api.clearSelection());
		assert.deepEqual(selected(), []);
		assert.equal(api.anchorId, undefined);
	});

	it("toggles all rows: on when any are unticked, off when they all are", () => {
		run(() => api.toggleAll(ids));
		assert.deepEqual(selected(), ids);

		run(() => api.toggleAll(ids));
		assert.deepEqual(selected(), []);

		run(() => api.toggle("a"));
		run(() => api.toggleAll(ids));
		assert.deepEqual(selected(), ids);
	});

	it("seeds the anchor without touching the selection", () => {
		run(() => api.setAnchor("c"));
		assert.deepEqual(selected(), []);
		assert.equal(api.anchorId, "c");
	});

	it("extends a range from the anchor, and keeps extending from it", () => {
		run(() => api.toggle("b"));
		run(() => api.selectRange(ids, "d"));
		assert.deepEqual(selected(), ["b", "c", "d"]);
		assert.equal(api.anchorId, "b");

		run(() => api.selectRange(ids, "a"));
		assert.deepEqual(selected().sort(), ["a", "b", "c", "d"]);
	});

	it("ranges from the fallback once the stored anchor has left the list", () => {
		run(() => api.toggle("a"));
		const visible = ["c", "d"];
		run(() => api.selectRange(visible, "d", "c"));
		assert.deepEqual(selected().sort(), ["a", "c", "d"]);
		assert.equal(api.anchorId, "c");
	});

	it("leaves the selection alone when the target is not in the list", () => {
		run(() => api.toggle("a"));
		run(() => api.selectRange(["c", "d"], "zzz"));
		assert.deepEqual(selected(), ["a"]);
	});

	it("narrows to the survivors of a refresh and keeps the rest", () => {
		run(() => api.selectAll(["a", "b", "c"]));
		run(() => api.intersectWith(["a", "c", "d"]));
		assert.deepEqual(selected(), ["a", "c"]);

		const before = api.selectedIds;
		run(() => api.intersectWith(["a", "c", "d"]));
		assert.equal(api.selectedIds, before);
	});

	it("stays put when nothing is selected to narrow", () => {
		const before = api.selectedIds;
		run(() => api.intersectWith(["a"]));
		assert.equal(api.selectedIds, before);
	});
});
