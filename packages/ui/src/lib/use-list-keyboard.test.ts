/**
 * The list's keyboard layer as a host mounts it: the keys reach the cursor from
 * inside the element the layer was given and from nowhere else, the row-click
 * path reads its modifiers the same way, the selection follows the rows it is
 * handed, and the footer offers only the actions the layer registered.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { type ListKeyboard, useListKeyboard } from "./use-list-keyboard.js";

const ALL_IDS = ["m1", "m2", "m3", "m4"];

let dom: JSDOM;
let container: HTMLElement;
let root: Root;
let list: ListKeyboard;

function Harness({ orderedIds }: { orderedIds: string[] }) {
	list = useListKeyboard({ orderedIds, isDesktop: true });
	return createElement("section", { id: "pane", ref: list.keyboard.ref });
}

const mount = (orderedIds: string[] = ALL_IDS) => {
	act(() => {
		root.render(createElement(Harness, { orderedIds }));
	});
};

const pane = (): HTMLElement => {
	const element = dom.window.document.getElementById("pane");
	assert.ok(element, "the harness rendered no pane");
	return element as unknown as HTMLElement;
};

const press = (
	key: string,
	init: KeyboardEventInit = {},
	target: EventTarget = pane(),
) => {
	act(() => {
		target.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", {
				key,
				bubbles: true,
				cancelable: true,
				...init,
			}),
		);
	});
};

const click = (
	id: string,
	modifiers: { shiftKey?: boolean; metaKey?: boolean } = {},
): boolean => {
	let took = false;
	act(() => {
		took =
			list.selection.onRowSelect?.(id, {
				shiftKey: false,
				metaKey: false,
				ctrlKey: false,
				...modifiers,
			}) ?? false;
	});
	return took;
};

const selected = () => Array.from(list.cursor.selection.selectedIds).sort();

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

describe("useListKeyboard", () => {
	it("registers the keys the footer may offer and no others", () => {
		assert.deepEqual(Object.keys(list.keyboard.handlers).sort(), [
			"back",
			"extendSelectDown",
			"extendSelectUp",
			"focusFirst",
			"focusLast",
			"focusNext",
			"focusPrevious",
			"selectAll",
			"toggleSelect",
		]);
	});

	it("moves the cursor the pane draws", () => {
		press("j");
		press("j");
		assert.equal(list.keyboard.focusedId, "m2");
	});

	it("ticks the row under the cursor", () => {
		press("j");
		press("x");
		assert.deepEqual(selected(), ["m1"]);
	});

	it("takes every loaded row with ⌘A", () => {
		press("a", { metaKey: true });
		assert.deepEqual(selected(), ALL_IDS);
	});

	it("leaves a key pressed outside its own element alone", () => {
		press("j", {}, dom.window.document.body);
		assert.equal(list.keyboard.focusedId, undefined);
	});

	it("ticks a row on a cmd-click without opening it", () => {
		assert.equal(click("m2", { metaKey: true }), true);
		assert.deepEqual(selected(), ["m2"]);
	});

	it("ranges from the last row touched on a shift-click", () => {
		click("m2");
		assert.equal(click("m4", { shiftKey: true }), true);
		assert.deepEqual(selected(), ["m2", "m3", "m4"]);
	});

	it("opens a plain click rather than taking it", () => {
		assert.equal(click("m2"), false);
		assert.deepEqual(selected(), []);
	});

	it("drops the ticked rows that leave the list, and keeps the rest", () => {
		press("a", { metaKey: true });
		assert.deepEqual(selected(), ALL_IDS);
		mount(["m1", "m3"]);
		assert.deepEqual(
			selected(),
			["m1", "m3"],
			"a verb acts on the rows that are still on screen",
		);
	});
});
