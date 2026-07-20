/**
 * SwipeableRow — jsdom gesture tests against the real react-aria long-press
 * wiring interacting with axis arbitration.
 *
 * The one this guards against: react-aria's `useLongPress` dispatches its
 * own synthetic `pointercancel` right before calling `onLongPress` (to
 * preempt other pointer consumers). SwipeableRow's `onPointerCancel` was
 * originally aliased straight to `onPointerUp`, whose "no axis claimed"
 * branch reads as a tap and calls `onOpen`/`onToggleCheck` — so a clean long
 * press would fire onLongPress AND a spurious onOpen in the same gesture.
 * The fix tags SwipeableRow's own axis-abort cancel so it can tell the two
 * apart; these tests exercise both paths against the real hook, not a
 * description of the fix.
 */

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ThreadRowData } from "./app-shell-types.js";
import { SwipeableRow, type SwipePeek } from "./swipeable-row.js";

const THRESHOLD_WAIT = 560; // default react-aria threshold (500ms) + margin

const thread: ThreadRowData = {
	id: "thread-1",
	accountId: "account-1",
	fromName: "Alex Rivera",
	fromEmail: "alex@example.com",
	subject: "Q3 planning notes",
	snippet: "Notes from the planning session.",
	timeLabel: "9:42",
	isRead: false,
};

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
	globalThis.SVGElement = dom.window.SVGElement;
	globalThis.PointerEvent = dom.window.PointerEvent;
	// jsdom does not implement the pointer-capture methods at all (not even
	// as no-ops) — SwipeableRow calls setPointerCapture once it claims the
	// horizontal axis, so an unpolyfilled call throws mid-gesture.
	dom.window.Element.prototype.setPointerCapture = () => undefined;
	dom.window.Element.prototype.releasePointerCapture = () => undefined;
	dom.window.Element.prototype.hasPointerCapture = () => false;
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

interface Handlers {
	onLongPress: () => void;
	onOpen: () => void;
	onPeek: (next: SwipePeek) => void;
}

function mount(handlers: Handlers) {
	act(() => {
		root.render(
			createElement(SwipeableRow, {
				thread,
				selectionMode: false,
				checked: false,
				active: false,
				peek: "none",
				onPeek: handlers.onPeek,
				onToggleCheck: () => undefined,
				onLongPress: handlers.onLongPress,
				onOpen: handlers.onOpen,
				onAct: () => undefined,
			}),
		);
	});
	// The open affordance is the one button with no aria-label — the
	// leading/trailing action buttons ("Mark as read" etc.) only render once
	// peeked, but querying by absence of aria-label is stable at rest too.
	const row = [...dom.window.document.querySelectorAll("button")].find(
		(b) => !b.hasAttribute("aria-label"),
	);
	assert.ok(row, "open-affordance button did not mount");
	return row;
}

// Each dispatch is wrapped in a synchronous act() so React commits the
// resulting state update before the next call reads it. Without this, a
// handler in the next dispatch can close over a stale pre-commit value (a
// real gap we hit developing this test: an unwrapped dispatch sequence read
// a stale `null` dragX in onPointerUp and mistook the just-completed swipe
// commit for a bare tap, firing a spurious onOpen).
function pointerDown(row: Element, x = 10, y = 10) {
	act(() => {
		row.dispatchEvent(
			new dom.window.PointerEvent("pointerdown", {
				bubbles: true,
				pointerType: "touch",
				pointerId: 1,
				clientX: x,
				clientY: y,
			}),
		);
	});
}

function pointerMove(row: Element, x: number, y: number) {
	act(() => {
		row.dispatchEvent(
			new dom.window.PointerEvent("pointermove", {
				bubbles: true,
				pointerType: "touch",
				pointerId: 1,
				clientX: x,
				clientY: y,
			}),
		);
	});
}

function pointerUp(row: Element) {
	// Dispatched on the row, not document: SwipeableRow's own onPointerUp is a
	// React prop on the row element, delegated via React's root-container
	// listener — an event whose target is `document` (an ancestor of the
	// root, not a descendant) never bubbles into that delegated listener.
	// A real browser routes pointerup to the pointer-capturing element
	// regardless of finger position once setPointerCapture has been called
	// (the horizontal-swipe case here), so this also matches real behavior.
	act(() => {
		row.dispatchEvent(
			new dom.window.PointerEvent("pointerup", {
				bubbles: true,
				pointerType: "touch",
				pointerId: 1,
			}),
		);
	});
}

function wait(ms: number) {
	return act(() => new Promise((resolve) => setTimeout(resolve, ms)));
}

describe("SwipeableRow gesture wiring (react-aria long press + axis arbitration)", () => {
	it("fires onLongPress on an unmoved press, with no spurious onOpen", async () => {
		let longPressed = 0;
		let opened = 0;
		const row = mount({
			onLongPress: () => longPressed++,
			onOpen: () => opened++,
			onPeek: () => undefined,
		});

		pointerDown(row);
		await wait(THRESHOLD_WAIT);
		pointerUp(row);

		assert.equal(longPressed, 1);
		assert.equal(
			opened,
			0,
			"react-aria's own pointercancel (dispatched right before onLongPress) must not be read as a tap-to-open",
		);
	});

	it("a horizontal drag past the axis threshold cancels the long press and commits a swipe peek, not onOpen", async () => {
		let longPressed = 0;
		let opened = 0;
		let committed: SwipePeek | undefined;
		const row = mount({
			onLongPress: () => longPressed++,
			onOpen: () => opened++,
			onPeek: (next) => {
				committed = next;
			},
		});

		pointerDown(row);
		pointerMove(row, 50, 10); // dx=40, past SWIPE_AXIS_THRESHOLD(10) and >= half SWIPE_ACTION_WIDTH(36)
		pointerUp(row);
		await wait(THRESHOLD_WAIT);

		assert.equal(
			longPressed,
			0,
			"long press must be cancelled once the horizontal axis is claimed",
		);
		assert.equal(opened, 0);
		assert.equal(committed, "leading");
	});

	it("a vertical drag past the axis threshold cancels the long press and lets scroll win (no peek, no open)", async () => {
		let longPressed = 0;
		let opened = 0;
		let peeked = 0;
		const row = mount({
			onLongPress: () => longPressed++,
			onOpen: () => opened++,
			onPeek: () => peeked++,
		});

		pointerDown(row);
		pointerMove(row, 10, 50); // dy=40, past SWIPE_AXIS_THRESHOLD(10), vertical wins
		pointerUp(row);
		await wait(THRESHOLD_WAIT);

		assert.equal(longPressed, 0);
		assert.equal(opened, 0);
		assert.equal(peeked, 0, "vertical scroll must not commit or reset a peek");
	});

	it("a small move within the axis threshold still allows the long press to fire", async () => {
		let longPressed = 0;
		const row = mount({
			onLongPress: () => longPressed++,
			onOpen: () => undefined,
			onPeek: () => undefined,
		});

		pointerDown(row);
		pointerMove(row, 13, 12); // dx=3, dy=2 — within SWIPE_AXIS_THRESHOLD(10)
		await wait(THRESHOLD_WAIT);

		assert.equal(longPressed, 1);
	});
});
