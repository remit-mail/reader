/**
 * use-long-press — exercises the real hook (react-aria's `useLongPress`)
 * against a jsdom-mounted element, not a reimplementation of its logic. The
 * hook this replaces (`packages/web-client/src/hooks/useLongPress.ts`) had a
 * decoy test that reimplemented the timer/threshold logic locally and so
 * gave zero regression coverage on the actual hook; these tests dispatch
 * real PointerEvents at a real mounted node and assert on the callback and
 * the DOM side effects react-aria owns (contextmenu suppression).
 *
 * jsdom is a devDependency scoped to this one test — react-aria's
 * pointerdown → threshold timer → onLongPress path, its global
 * pointerup/pointercancel listeners, and its contextmenu suppression all
 * need a real `document`/`window`/`PointerEvent`, which `renderToString`
 * (the pattern used elsewhere in this repo for presentational components)
 * cannot exercise.
 */

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useLongPress } from "./use-long-press.js";

const THRESHOLD = 40;

let dom: JSDOM;
let container: HTMLElement;
let root: Root;

function Row(props: {
	onLongPress: () => void;
	isDisabled?: boolean;
	accessibilityDescription?: string;
}) {
	const { longPressProps } = useLongPress({
		onLongPress: props.onLongPress,
		isDisabled: props.isDisabled,
		delayMs: THRESHOLD,
		accessibilityDescription: props.accessibilityDescription,
	});
	return createElement(
		"a",
		{ id: "row", href: "/thread/1", ...longPressProps },
		"row",
	);
}

function mount(props: {
	onLongPress: () => void;
	isDisabled?: boolean;
	accessibilityDescription?: string;
}) {
	act(() => {
		root.render(createElement(Row, props));
	});
	const row = dom.window.document.getElementById("row");
	assert.ok(row, "row did not mount");
	return row;
}

function pointerDown(row: Element) {
	row.dispatchEvent(
		new dom.window.PointerEvent("pointerdown", {
			bubbles: true,
			pointerType: "touch",
			pointerId: 1,
			clientX: 10,
			clientY: 10,
		}),
	);
}

function pointerUp() {
	dom.window.document.dispatchEvent(
		new dom.window.PointerEvent("pointerup", {
			bubbles: true,
			pointerType: "touch",
			pointerId: 1,
			clientX: 10,
			clientY: 10,
		}),
	);
}

function pointerCancel(row: Element) {
	row.dispatchEvent(
		new dom.window.PointerEvent("pointercancel", { bubbles: true }),
	);
}

function wait(ms: number) {
	return act(() => new Promise((resolve) => setTimeout(resolve, ms)));
}

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
	globalThis.PointerEvent = dom.window.PointerEvent;
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

describe("useLongPress (react-aria wrapper)", () => {
	it("fires onLongPress after the threshold with no interruption", async () => {
		let fired = 0;
		const row = mount({ onLongPress: () => fired++ });

		pointerDown(row);
		await wait(THRESHOLD + 40);

		assert.equal(fired, 1);
	});

	it("does not fire when released before the threshold", async () => {
		let fired = 0;
		const row = mount({ onLongPress: () => fired++ });

		pointerDown(row);
		await wait(THRESHOLD / 2);
		pointerUp();
		await wait(THRESHOLD + 40);

		assert.equal(fired, 0);
	});

	it("does not fire when cancelled via a pointercancel before the threshold", async () => {
		// This is the mechanism SwipeableRow's axis arbitration relies on: it
		// dispatches a synthetic pointercancel to abort a pending long press
		// once a horizontal or vertical drag claims the gesture.
		let fired = 0;
		const row = mount({ onLongPress: () => fired++ });

		pointerDown(row);
		await wait(THRESHOLD / 2);
		pointerCancel(row);
		await wait(THRESHOLD + 40);

		assert.equal(fired, 0);
	});

	it("does not fire while isDisabled", async () => {
		let fired = 0;
		const row = mount({ onLongPress: () => fired++, isDisabled: true });

		pointerDown(row);
		await wait(THRESHOLD + 40);

		assert.equal(fired, 0);
	});

	it("suppresses the native contextmenu that follows a touch long press", async () => {
		let fired = 0;
		const row = mount({ onLongPress: () => fired++ });

		pointerDown(row);
		await wait(THRESHOLD + 40);
		assert.equal(
			fired,
			1,
			"long press must have fired for this to be meaningful",
		);

		const contextMenuEvent = new dom.window.MouseEvent("contextmenu", {
			bubbles: true,
			cancelable: true,
		});
		row.dispatchEvent(contextMenuEvent);

		assert.equal(
			contextMenuEvent.defaultPrevented,
			true,
			"react-aria suppresses the link context menu that Android/Chrome fires after a touch long press",
		);
	});

	it("does not suppress contextmenu when no long press occurred", async () => {
		mount({ onLongPress: () => undefined });
		const row = dom.window.document.getElementById("row") as Element;

		const contextMenuEvent = new dom.window.MouseEvent("contextmenu", {
			bubbles: true,
			cancelable: true,
		});
		row.dispatchEvent(contextMenuEvent);

		assert.equal(contextMenuEvent.defaultPrevented, false);
	});
});
