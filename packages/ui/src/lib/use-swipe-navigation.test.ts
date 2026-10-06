import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MobileReadingPane } from "../components/mobile-reading-pane.js";
import { SWIPE_EVENT } from "./use-swipe-navigation.js";

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
	Object.defineProperty(window, "visualViewport", {
		value: undefined,
		configurable: true,
	});
});

interface Navigation {
	next: number;
	previous: number;
}

function mount(): { area: HTMLElement; navigation: Navigation } {
	const navigation: Navigation = { next: 0, previous: 0 };
	act(() => {
		root.render(
			createElement(
				MobileReadingPane,
				{
					thread: { subject: "Subject", messages: [] },
					onBack: () => undefined,
					onSwipeNext: () => navigation.next++,
					onSwipePrevious: () => navigation.previous++,
				},
				createElement("p", { id: "body" }, "body"),
			),
		);
	});
	const body = document.getElementById("body");
	assert.ok(body?.parentElement, "reading area did not mount");
	return { area: body.parentElement, navigation };
}

function touch(
	target: Element,
	type: "pointerdown" | "pointermove" | "pointerup",
	x: number,
	y: number,
	pointerType = "touch",
) {
	act(() => {
		target.dispatchEvent(
			new PointerEvent(type, {
				bubbles: true,
				buttons: type === "pointerup" ? 0 : 1,
				pointerType,
				pointerId: 1,
				clientX: x,
				clientY: y,
			}),
		);
	});
}

function drag(
	target: Element,
	from: [number, number],
	to: [number, number],
	pointerType = "touch",
) {
	touch(target, "pointerdown", from[0], from[1], pointerType);
	touch(target, "pointermove", to[0] / 2 + from[0] / 2, from[1], pointerType);
	touch(target, "pointermove", to[0], to[1], pointerType);
	touch(target, "pointerup", to[0], to[1], pointerType);
}

describe("reading pane swipe", () => {
	it("opens the next message on a swipe left", () => {
		const { area, navigation } = mount();

		drag(area, [300, 200], [100, 205]);

		assert.deepEqual(navigation, { next: 1, previous: 0 });
	});

	it("opens the previous message on a swipe right", () => {
		const { area, navigation } = mount();

		drag(area, [100, 200], [300, 195]);

		assert.deepEqual(navigation, { next: 0, previous: 1 });
	});

	it("ignores a drag shorter than the swipe distance", () => {
		const { area, navigation } = mount();

		drag(area, [200, 200], [170, 200]);

		assert.deepEqual(navigation, { next: 0, previous: 0 });
	});

	it("ignores a mostly vertical drag, which is a scroll", () => {
		const { area, navigation } = mount();

		drag(area, [200, 100], [140, 500]);

		assert.deepEqual(navigation, { next: 0, previous: 0 });
	});

	it("ignores a mouse drag", () => {
		const { area, navigation } = mount();

		drag(area, [300, 200], [100, 200], "mouse");

		assert.deepEqual(navigation, { next: 0, previous: 0 });
	});

	it("opens the next message on a swipe raised inside the message frame", () => {
		const { area, navigation } = mount();

		act(() => {
			area.dispatchEvent(
				new CustomEvent(SWIPE_EVENT, { bubbles: true, detail: "left" }),
			);
		});

		assert.deepEqual(navigation, { next: 1, previous: 0 });
	});

	it("leaves the browser to pan and pinch while the page is zoomed in", () => {
		Object.defineProperty(window, "visualViewport", {
			value: {
				scale: 2,
				addEventListener: () => undefined,
				removeEventListener: () => undefined,
			},
			configurable: true,
		});
		const { area, navigation } = mount();

		drag(area, [300, 200], [100, 200]);

		assert.deepEqual(navigation, { next: 0, previous: 0 });
		assert.equal(area.style.touchAction, "auto");
	});

	it("keeps native pinch-zoom enabled at rest", () => {
		const { area } = mount();

		assert.equal(area.style.touchAction, "pan-y pinch-zoom");
	});
});
