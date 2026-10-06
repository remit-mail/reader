import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ThreadRowData } from "./app-shell-types.js";
import { SwipeableRow, type SwipePeek } from "./swipeable-row.js";

const THRESHOLD_WAIT = 560;

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

let container: HTMLElement;
let root: Root;

beforeEach(() => {
	container = document.getElementById("root") as unknown as HTMLElement;
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
	onToggleCheck?: () => void;
	selectionMode?: boolean;
}

function mount(handlers: Handlers) {
	act(() => {
		root.render(
			createElement(SwipeableRow, {
				thread,
				selectionMode: handlers.selectionMode ?? false,
				checked: false,
				active: false,
				peek: "none",
				onPeek: handlers.onPeek,
				onToggleCheck: handlers.onToggleCheck ?? (() => undefined),
				onLongPress: handlers.onLongPress,
				onOpen: handlers.onOpen,
				onAct: () => undefined,
			}),
		);
	});
	// The open affordance is the one button with no aria-label — the
	// leading/trailing action buttons ("Mark as read" etc.) only render once
	// peeked, but querying by absence of aria-label is stable at rest too.
	const row = [...document.querySelectorAll("button")].find(
		(b) => !b.hasAttribute("aria-label"),
	);
	assert.ok(row, "open-affordance button did not mount");
	return row;
}

function contextMenu(row: Element) {
	const event = new MouseEvent("contextmenu", {
		bubbles: true,
		cancelable: true,
	});
	row.dispatchEvent(event);
	return event;
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
			new PointerEvent("pointerdown", {
				bubbles: true,
				buttons: 1,
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
			new PointerEvent("pointermove", {
				bubbles: true,
				buttons: 1,
				pointerType: "touch",
				pointerId: 1,
				clientX: x,
				clientY: y,
			}),
		);
	});
}

function pointerCancel(row: Element) {
	act(() => {
		row.dispatchEvent(
			new PointerEvent("pointercancel", {
				bubbles: true,
				pointerType: "touch",
				pointerId: 1,
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
			new PointerEvent("pointerup", {
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

describe("SwipeableRow gesture wiring", () => {
	it("fires onLongPress on an unmoved press, with no tap action on release", async () => {
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
		assert.equal(opened, 0, "a release after the hold is not a tap");
	});

	it("a horizontal drag past the escape distance cancels the long press and commits a swipe peek, not onOpen", async () => {
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

	it("a vertical drag past the escape distance cancels the long press and lets scroll win (no peek, no open)", async () => {
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

	it("a hold that drifts past the axis threshold still enters selection mode", async () => {
		// The reported phone bug: the row tracked the drift (the visible shiver)
		// and the press died, but the drift was too short to commit a peek, so
		// the whole gesture produced nothing.
		let longPressed = 0;
		let opened = 0;
		const peeks: SwipePeek[] = [];
		const row = mount({
			onLongPress: () => longPressed++,
			onOpen: () => opened++,
			onPeek: (next) => peeks.push(next),
		});

		pointerDown(row, 100, 200);
		pointerMove(row, 103, 201);
		pointerMove(row, 106, 203);
		pointerMove(row, 109, 205);
		pointerMove(row, 112, 206); // dx=12 — past the axis threshold, under the escape
		await wait(THRESHOLD_WAIT);
		pointerUp(row);

		assert.equal(longPressed, 1);
		assert.equal(opened, 0);
		assert.deepEqual(peeks, [], "drift must not commit or reset a peek");
	});

	it("a hold that drifts vertically past the axis threshold still enters selection mode", async () => {
		let longPressed = 0;
		const peeks: SwipePeek[] = [];
		const row = mount({
			onLongPress: () => longPressed++,
			onOpen: () => undefined,
			onPeek: (next) => peeks.push(next),
		});

		pointerDown(row, 100, 200);
		pointerMove(row, 101, 206);
		pointerMove(row, 102, 213); // dy=13 — past the axis threshold, under the escape
		await wait(THRESHOLD_WAIT);
		pointerUp(row);

		assert.equal(longPressed, 1);
		assert.deepEqual(peeks, []);
	});

	it("an aborted short drag opens nothing on release", async () => {
		let opened = 0;
		const peeks: SwipePeek[] = [];
		const row = mount({
			onLongPress: () => undefined,
			onOpen: () => opened++,
			onPeek: (next) => peeks.push(next),
		});

		pointerDown(row, 100, 200);
		pointerMove(row, 120, 201);
		pointerUp(row);
		await wait(200);

		assert.equal(opened, 0);
		assert.deepEqual(peeks, []);
	});

	it("a short press opens the message", async () => {
		let opened = 0;
		let longPressed = 0;
		const row = mount({
			onLongPress: () => longPressed++,
			onOpen: () => opened++,
			onPeek: () => undefined,
		});

		pointerDown(row);
		pointerUp(row);
		await wait(THRESHOLD_WAIT);

		assert.equal(opened, 1);
		assert.equal(longPressed, 0);
	});

	it("a short press in selection mode toggles the row and opens nothing", async () => {
		let opened = 0;
		let toggled = 0;
		const row = mount({
			selectionMode: true,
			onLongPress: () => undefined,
			onOpen: () => opened++,
			onToggleCheck: () => toggled++,
			onPeek: () => undefined,
		});

		pointerDown(row);
		pointerUp(row);

		assert.equal(toggled, 1);
		assert.equal(opened, 0);
	});

	it("a browser pointercancel resets the gesture and fires nothing", async () => {
		let longPressed = 0;
		let opened = 0;
		const peeks: SwipePeek[] = [];
		const row = mount({
			onLongPress: () => longPressed++,
			onOpen: () => opened++,
			onPeek: (next) => peeks.push(next),
		});

		pointerDown(row);
		pointerMove(row, 50, 10);
		pointerCancel(row);
		await wait(THRESHOLD_WAIT);

		assert.equal(longPressed, 0);
		assert.equal(opened, 0);
		assert.deepEqual(peeks, []);
	});

	it("a press cancelled before the hold fires no long press", async () => {
		let longPressed = 0;
		const row = mount({
			onLongPress: () => longPressed++,
			onOpen: () => undefined,
			onPeek: () => undefined,
		});

		pointerDown(row);
		pointerCancel(row);
		await wait(THRESHOLD_WAIT);

		assert.equal(longPressed, 0);
	});

	it("suppresses the native context menu raised over a drifting hold", async () => {
		// Android Chrome raises its own menu at its own threshold, which can land
		// mid-drift and ahead of the app's long press.
		const row = mount({
			onLongPress: () => undefined,
			onOpen: () => undefined,
			onPeek: () => undefined,
		});

		pointerDown(row, 100, 200);
		pointerMove(row, 112, 206);

		assert.equal(contextMenu(row).defaultPrevented, true);
	});
});
