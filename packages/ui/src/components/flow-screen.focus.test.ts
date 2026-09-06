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
