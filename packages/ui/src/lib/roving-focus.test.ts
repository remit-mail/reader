/**
 * roving-focus — `rovingNextIndex` is pure and exercised directly; the hook is
 * exercised against jsdom-mounted elements, following `use-long-press.test.ts`:
 * real KeyboardEvents at a real focused node, asserting on the DOM side effects
 * the hook owns (focus, tabIndex), which `renderToString` cannot reach.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import { act, createElement, type RefObject, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	LIST_ROW_ATTRIBUTE,
	LIST_ROW_SELECTOR,
	rovingNextIndex,
	useRovingFocus,
} from "./roving-focus.js";

describe("rovingNextIndex", () => {
	it("moves forward and clamps at the last item", () => {
		assert.equal(rovingNextIndex("ArrowDown", -1, 3), 0);
		assert.equal(rovingNextIndex("ArrowDown", 0, 3), 1);
		assert.equal(rovingNextIndex("ArrowDown", 2, 3), 2);
	});

	it("moves backward and clamps at the first item", () => {
		assert.equal(rovingNextIndex("ArrowUp", -1, 3), 0);
		assert.equal(rovingNextIndex("ArrowUp", 2, 3), 1);
		assert.equal(rovingNextIndex("ArrowUp", 0, 3), 0);
	});

	it("Home and End jump to the first/last item", () => {
		assert.equal(rovingNextIndex("Home", 2, 5), 0);
		assert.equal(rovingNextIndex("End", 0, 5), 4);
	});

	it("ignores unrelated keys", () => {
		assert.equal(rovingNextIndex("Tab", 0, 3), null);
		assert.equal(rovingNextIndex("Enter", 0, 3), null);
	});

	it("returns null for an empty group regardless of key", () => {
		assert.equal(rovingNextIndex("ArrowDown", 0, 0), null);
		assert.equal(rovingNextIndex("Home", -1, 0), null);
	});

	it("uses Left/Right instead of Up/Down in a horizontal group", () => {
		assert.equal(rovingNextIndex("ArrowRight", 0, 3, "horizontal"), 1);
		assert.equal(rovingNextIndex("ArrowLeft", 1, 3, "horizontal"), 0);
		assert.equal(rovingNextIndex("ArrowDown", 0, 3, "horizontal"), null);
	});
});

let dom: JSDOM;
let container: HTMLElement;
let root: Root;

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
	globalThis.KeyboardEvent = dom.window.KeyboardEvent;
	Object.defineProperty(globalThis, "navigator", {
		value: dom.window.navigator,
		configurable: true,
	});
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
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
});

function pressKey(target: Element, key: string) {
	target.dispatchEvent(
		new dom.window.KeyboardEvent("keydown", { key, bubbles: true }),
	);
}

function rows(): HTMLButtonElement[] {
	return Array.from(container.querySelectorAll(LIST_ROW_SELECTOR));
}

interface GroupProps {
	count: number;
	containerRef: RefObject<HTMLDivElement | null>;
	/** Renders an unmarked control beside every row, as a real list does. */
	withNestedControls?: boolean;
}

function Group({ count, containerRef, withNestedControls }: GroupProps) {
	useRovingFocus({ containerRef, itemSelector: LIST_ROW_SELECTOR });
	return createElement(
		"div",
		{ ref: containerRef },
		Array.from({ length: count }, (_, i) =>
			createElement(
				"div",
				{ key: i },
				createElement(
					"button",
					{ type: "button", ...LIST_ROW_ATTRIBUTE },
					`row-${i}`,
				),
				withNestedControls
					? createElement("button", { type: "button" }, `action-${i}`)
					: null,
			),
		),
	);
}

function Harness(props: Omit<GroupProps, "containerRef">) {
	const containerRef = useRef<HTMLDivElement>(null);
	return createElement(Group, { ...props, containerRef });
}

function mount(props: Omit<GroupProps, "containerRef">) {
	act(() => {
		root.render(createElement(Harness, props));
	});
}

describe("useRovingFocus", () => {
	it("gives only the first row a tab stop before any focus has moved", () => {
		mount({ count: 3 });
		const items = rows();
		assert.equal(items[0]?.tabIndex, 0);
		assert.equal(items[1]?.tabIndex, -1);
		assert.equal(items[2]?.tabIndex, -1);
	});

	it("ArrowDown moves focus to the next row and the tab stop follows", () => {
		mount({ count: 3 });
		const items = rows();
		act(() => items[0]?.focus());
		act(() => pressKey(items[0] as Element, "ArrowDown"));

		assert.equal(dom.window.document.activeElement, items[1]);
		assert.equal(items[1]?.tabIndex, 0);
		assert.equal(items[0]?.tabIndex, -1);
	});

	it("ArrowUp clamps at the first row", () => {
		mount({ count: 3 });
		const items = rows();
		act(() => items[0]?.focus());
		act(() => pressKey(items[0] as Element, "ArrowUp"));

		assert.equal(dom.window.document.activeElement, items[0]);
	});

	it("ArrowDown clamps at the last row", () => {
		mount({ count: 2 });
		const items = rows();
		act(() => items[1]?.focus());
		act(() => pressKey(items[1] as Element, "ArrowDown"));

		assert.equal(dom.window.document.activeElement, items[1]);
	});

	it("Home/End jump to the first/last row", () => {
		mount({ count: 4 });
		const items = rows();
		act(() => items[2]?.focus());
		act(() => pressKey(items[2] as Element, "End"));
		assert.equal(dom.window.document.activeElement, items[3]);

		act(() => pressKey(items[3] as Element, "Home"));
		assert.equal(dom.window.document.activeElement, items[0]);
	});

	it("mouse-focusing a row moves the tab stop there too", () => {
		mount({ count: 3 });
		const items = rows();
		act(() => items[2]?.focus());

		assert.equal(items[2]?.tabIndex, 0);
		assert.equal(items[0]?.tabIndex, -1);
	});

	it("steps over controls that are not rows", () => {
		mount({ count: 3, withNestedControls: true });
		const items = rows();
		act(() => items[0]?.focus());
		act(() => pressKey(items[0] as Element, "ArrowDown"));

		assert.equal(dom.window.document.activeElement, items[1]);
		assert.match(items[1]?.textContent ?? "", /row-1/);
	});

	it("enters at the first row when focus sits on a non-row control", () => {
		mount({ count: 3, withNestedControls: true });
		const nested = container.querySelectorAll<HTMLButtonElement>(
			`button:not(${LIST_ROW_SELECTOR})`,
		);
		act(() => nested[1]?.focus());
		act(() => pressKey(nested[1] as Element, "ArrowDown"));

		assert.equal(dom.window.document.activeElement, rows()[0]);
	});

	it("keeps a handled key from reaching a window-level listener", () => {
		mount({ count: 3 });
		let seen = 0;
		const spy = () => {
			seen += 1;
		};
		dom.window.addEventListener("keydown", spy);
		const items = rows();
		act(() => items[0]?.focus());
		act(() => pressKey(items[0] as Element, "ArrowDown"));
		act(() => pressKey(items[1] as Element, "Enter"));
		dom.window.removeEventListener("keydown", spy);

		assert.equal(seen, 1);
	});
});
