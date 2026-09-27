import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CalendarSuggestionDeck } from "./calendar-suggestion-deck.js";

let container: HTMLElement;
let root: Root;
let captured: number[];
let confirmed: number;
let pressed: number;

const originalSet = HTMLElement.prototype.setPointerCapture;
const originalHas = HTMLElement.prototype.hasPointerCapture;

beforeEach(() => {
	captured = [];
	confirmed = 0;
	pressed = 0;
	HTMLElement.prototype.setPointerCapture = (pointerId: number) => {
		captured.push(pointerId);
	};
	HTMLElement.prototype.hasPointerCapture = (pointerId: number) =>
		captured.includes(pointerId);
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	act(() => {
		root.render(
			createElement(CalendarSuggestionDeck, {
				hasCard: true,
				remaining: 1,
				blocked: false,
				blockedReason: "",
				onConfirm: () => {
					confirmed += 1;
				},
				onReject: () => undefined,
				children: createElement(
					"button",
					{
						type: "button",
						onClick: () => {
							pressed += 1;
						},
					},
					"Change first",
				),
			}),
		);
	});
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
	HTMLElement.prototype.setPointerCapture = originalSet;
	HTMLElement.prototype.hasPointerCapture = originalHas;
});

const pointer = (target: Element, type: string, clientX: number) => {
	act(() => {
		target.dispatchEvent(
			new PointerEvent(type, { bubbles: true, clientX, pointerId: 1 }),
		);
	});
};

const button = (): HTMLButtonElement => {
	const found = container.querySelector("button");
	if (!found) throw new Error("the card's button is not drawn");
	return found;
};

describe("pressing a button on the top card", () => {
	it("leaves the pointer to the button, so the press reaches it", () => {
		pointer(button(), "pointerdown", 100);
		pointer(button(), "pointerup", 100);
		act(() => button().click());

		assert.deepEqual(captured, []);
		assert.equal(pressed, 1);
		assert.equal(confirmed, 0);
	});

	it("still takes the pointer once the card is dragged, and a long drag confirms", () => {
		pointer(button(), "pointerdown", 100);
		pointer(button(), "pointermove", 150);
		pointer(button(), "pointermove", 220);
		pointer(button(), "pointerup", 220);

		assert.deepEqual(captured, [1]);
		assert.equal(confirmed, 1);
	});
});
