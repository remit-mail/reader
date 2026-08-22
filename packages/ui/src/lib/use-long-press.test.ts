/**
 * use-long-press — exercises the real hook (react-aria's `useLongPress`)
 * against a jsdom-mounted element, not a reimplementation of its logic. The
 * hook this replaces (`packages/web-client/src/hooks/useLongPress.ts`) had a
 * decoy test that reimplemented the timer/threshold logic locally and so
 * gave zero regression coverage on the actual hook; these tests dispatch
 * real PointerEvents at a real mounted node and assert on the callback and
 * the DOM side effects react-aria owns (contextmenu suppression).
 *
 * react-aria's pointerdown → threshold timer → onLongPress path, its global
 * pointerup/pointercancel listeners, and its contextmenu suppression all
 * need a real `document`/`window`/`PointerEvent`, which `renderToString`
 * (the pattern used elsewhere in this repo for presentational components)
 * cannot exercise.
 *
 * The clock is mocked. Every timing assertion here is about one boundary —
 * the press crossed the threshold, or it ended first — and racing that
 * boundary against a wall clock on a loaded runner turns a passing test red
 * (#645). Time only moves when `advance` moves it.
 */

import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useLongPress } from "./use-long-press.js";

const THRESHOLD = 40;

/** Past react-aria's own teardown of its transient post-pointerup contextmenu listener. */
const AFTER_ARIA_CONTEXTMENU_TEARDOWN = 100;

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
	const row = document.getElementById("row");
	assert.ok(row, "row did not mount");
	return row;
}

function pointerDown(row: Element, pointerType = "touch") {
	row.dispatchEvent(
		new PointerEvent("pointerdown", {
			bubbles: true,
			pointerType,
			pointerId: 1,
			clientX: 10,
			clientY: 10,
		}),
	);
}

function dispatchContextMenu(row: Element) {
	const event = new MouseEvent("contextmenu", {
		bubbles: true,
		cancelable: true,
	});
	row.dispatchEvent(event);
	return event;
}

function pointerUp() {
	document.dispatchEvent(
		new PointerEvent("pointerup", {
			bubbles: true,
			pointerType: "touch",
			pointerId: 1,
			clientX: 10,
			clientY: 10,
		}),
	);
}

function pointerUpOn(row: Element) {
	row.dispatchEvent(
		new PointerEvent("pointerup", {
			bubbles: true,
			pointerType: "touch",
			pointerId: 1,
			clientX: 10,
			clientY: 10,
		}),
	);
}

function pointerCancel(row: Element) {
	row.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
}

function advance(ms: number) {
	return act(() => {
		mock.timers.tick(ms);
	});
}

beforeEach(() => {
	container = document.getElementById("root") as unknown as HTMLElement;
	container.innerHTML = "";
	root = createRoot(container);
	mock.timers.enable({ apis: ["setTimeout"] });
});

afterEach(() => {
	mock.timers.reset();
	act(() => {
		root.unmount();
	});
});

describe("useLongPress (react-aria wrapper)", () => {
	it("fires onLongPress after the threshold with no interruption", async () => {
		let fired = 0;
		const row = mount({ onLongPress: () => fired++ });

		pointerDown(row);
		await advance(THRESHOLD - 1);
		assert.equal(fired, 0, "the threshold had not elapsed yet");

		await advance(1);

		assert.equal(fired, 1);
	});

	it("does not fire when released before the threshold", async () => {
		let fired = 0;
		const row = mount({ onLongPress: () => fired++ });

		pointerDown(row);
		await advance(THRESHOLD - 1);
		pointerUp();
		await advance(THRESHOLD);

		assert.equal(fired, 0);
	});

	it("does not fire when cancelled via a pointercancel before the threshold", async () => {
		// This is the mechanism SwipeableRow's axis arbitration relies on: it
		// dispatches a synthetic pointercancel to abort a pending long press
		// once a horizontal or vertical drag claims the gesture.
		let fired = 0;
		const row = mount({ onLongPress: () => fired++ });

		pointerDown(row);
		await advance(THRESHOLD - 1);
		pointerCancel(row);
		await advance(THRESHOLD);

		assert.equal(fired, 0);
	});

	it("does not fire while isDisabled", async () => {
		let fired = 0;
		const row = mount({ onLongPress: () => fired++, isDisabled: true });

		pointerDown(row);
		await advance(THRESHOLD);

		assert.equal(fired, 0);
	});

	it("suppresses the native contextmenu that follows a touch long press", async () => {
		let fired = 0;
		const row = mount({ onLongPress: () => fired++ });

		pointerDown(row);
		await advance(THRESHOLD);
		assert.equal(
			fired,
			1,
			"long press must have fired for this to be meaningful",
		);

		assert.equal(
			dispatchContextMenu(row).defaultPrevented,
			true,
			"the link context menu Android/Chrome fires after a touch long press is suppressed",
		);
	});

	it("suppresses the touch contextmenu even before the long-press threshold", async () => {
		// Android Chrome can raise the link menu at its own threshold, ahead of
		// the app's long press; keying suppression to the pointer type rather
		// than to a fired long press covers that race.
		const row = mount({ onLongPress: () => undefined });

		pointerDown(row, "touch");
		assert.equal(dispatchContextMenu(row).defaultPrevented, true);
	});

	it("does not suppress contextmenu from a mouse right-click", async () => {
		// Desktop right-click must keep its native context menu; a mouse
		// pointerdown precedes the contextmenu, so the pointer type is known.
		const row = mount({ onLongPress: () => undefined });

		pointerDown(row, "mouse");
		assert.equal(dispatchContextMenu(row).defaultPrevented, false);
	});

	it("does not suppress contextmenu when no pointer interaction preceded it", async () => {
		mount({ onLongPress: () => undefined });
		const row = document.getElementById("row") as Element;

		assert.equal(dispatchContextMenu(row).defaultPrevented, false);
	});

	it("does not suppress the keyboard menu that follows a touch long press", async () => {
		// The reported a11y regression: the touch press's pointer type must not
		// linger and suppress the keyboard-invoked menu (Context-Menu key /
		// Shift+F10), which fires with no preceding pointerdown.
		const row = mount({ onLongPress: () => undefined });

		pointerDown(row, "touch");
		assert.equal(
			dispatchContextMenu(row).defaultPrevented,
			true,
			"the touch long-press menu is still suppressed",
		);
		pointerUpOn(row);
		await advance(AFTER_ARIA_CONTEXTMENU_TEARDOWN);

		assert.equal(
			dispatchContextMenu(row).defaultPrevented,
			false,
			"the later keyboard-invoked menu must not inherit the touch press's type",
		);
	});

	it("does not suppress the keyboard menu after a touch tap that raised no menu", async () => {
		// A tap that lifts without a menu must still disarm suppression. The
		// advance clears react-aria's own transient post-touch contextmenu
		// listener, which it removes shortly after pointerup — in a browser a
		// keyboard menu arrives long after that, so only this hook's ref decides.
		const row = mount({ onLongPress: () => undefined });

		pointerDown(row, "touch");
		pointerUpOn(row);
		await advance(AFTER_ARIA_CONTEXTMENU_TEARDOWN);

		assert.equal(dispatchContextMenu(row).defaultPrevented, false);
	});
});
