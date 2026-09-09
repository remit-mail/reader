import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FlowScreen, type FlowScreenProps } from "./flow-screen.js";

let root: Root;

beforeEach(() => {
	const container = document.getElementById("root") as unknown as HTMLElement;
	container.innerHTML = "";
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
});

const screen = (anchor: FlowScreenProps["anchor"]) => {
	// createElement never folds the children argument into the props type, so a
	// component with required children needs the props cast.
	const props: Omit<FlowScreenProps, "children"> = {
		title: "Pick a calendar",
		steps: ["Calendar"],
		activeStep: 0,
		onBack: () => undefined,
		onExit: () => undefined,
		anchor,
	};
	return createElement(
		FlowScreen,
		props as FlowScreenProps,
		createElement("button", { type: "button" }, "Body action"),
	);
};

const surface = (): HTMLElement => {
	const element = document.querySelector<HTMLElement>("#root > *");
	assert.ok(element, "no screen rendered");
	return element;
};

const tab = (): KeyboardEvent => {
	const event = new KeyboardEvent("keydown", {
		key: "Tab",
		bubbles: true,
		cancelable: true,
	});
	(document.activeElement ?? document).dispatchEvent(event);
	return event;
};

describe("FlowScreen focus", () => {
	it("takes the keyboard when it covers the window", () => {
		act(() => root.render(screen("viewport")));

		assert.equal(document.activeElement?.getAttribute("aria-label"), "Back");
	});

	/**
	 * The contained variant fills a pane that is already on screen rather than
	 * covering the app, so the controls around it stay reachable.
	 */
	it("leaves the keyboard alone when it fills a pane", () => {
		const outside = document.createElement("button");
		outside.textContent = "Beside the pane";
		document.body.appendChild(outside);
		outside.focus();

		act(() => root.render(screen("container")));
		assert.equal(document.activeElement, outside);

		const event = tab();

		assert.equal(event.defaultPrevented, false);
		assert.equal(document.activeElement, outside);
		outside.remove();
	});
});

/**
 * What the screen claims and what it does have to be the same statement: a
 * surface that says the rest of the page is gone while Tab walks into it tells a
 * screen-reader user the opposite of what the keyboard does (#1204).
 */
describe("FlowScreen semantics", () => {
	it("is a modal dialog when it covers the window", () => {
		act(() => root.render(screen("viewport")));

		const element = surface();
		assert.equal(element.getAttribute("role"), "dialog");
		assert.equal(element.getAttribute("aria-modal"), "true");
		assert.equal(element.getAttribute("aria-label"), "Pick a calendar");
	});

	/** A labelled `section` is a region, which is what a pane's content is. */
	it("is a labelled region when it fills a pane", () => {
		act(() => root.render(screen("container")));

		const element = surface();
		assert.equal(element.tagName, "SECTION");
		assert.equal(element.getAttribute("role"), null);
		assert.equal(element.getAttribute("aria-modal"), null);
		assert.equal(element.getAttribute("aria-label"), "Pick a calendar");
	});
});
