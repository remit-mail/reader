import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useModalFocus } from "./use-modal-focus.js";

let root: Root;

beforeEach(() => {
	const container = document.getElementById("root") as unknown as HTMLElement;
	container.innerHTML = "";
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
});

function Panel({ open }: { open: boolean }) {
	const ref = useRef<HTMLDivElement>(null);
	useModalFocus(ref, open);
	return createElement(
		"div",
		{ ref },
		createElement("span", null, "not focusable"),
		createElement("button", { type: "button" }, "First action"),
		createElement("button", { type: "button" }, "Second action"),
	);
}

const tab = (shiftKey = false): KeyboardEvent => {
	const event = new KeyboardEvent("keydown", {
		key: "Tab",
		shiftKey,
		bubbles: true,
		cancelable: true,
	});
	(document.activeElement ?? document).dispatchEvent(event);
	return event;
};

const buttonNamed = (name: string): HTMLElement => {
	const match = Array.from(document.querySelectorAll("button")).find(
		(el) => el.textContent === name,
	);
	assert.ok(match, `no button named ${name}`);
	return match;
};

describe("useModalFocus", () => {
	it("focuses the first focusable descendant once open", () => {
		act(() => root.render(createElement(Panel, { open: true })));
		assert.equal(document.activeElement?.textContent, "First action");
	});

	it("leaves focus on the body while closed", () => {
		act(() => root.render(createElement(Panel, { open: false })));
		assert.equal(document.activeElement, document.body);
	});

	it("moves focus in when an already-mounted panel opens", () => {
		act(() => root.render(createElement(Panel, { open: false })));
		assert.equal(document.activeElement, document.body);

		act(() => root.render(createElement(Panel, { open: true })));
		assert.equal(document.activeElement?.textContent, "First action");
	});

	it("returns focus to the trigger once the panel closes", () => {
		const trigger = document.createElement("button");
		trigger.textContent = "Open panel";
		document.body.appendChild(trigger);
		trigger.focus();
		assert.equal(document.activeElement, trigger);

		act(() => root.render(createElement(Panel, { open: true })));
		assert.equal(document.activeElement?.textContent, "First action");

		act(() => root.render(createElement(Panel, { open: false })));
		assert.equal(document.activeElement, trigger);

		trigger.remove();
	});

	it("does not throw restoring focus to a trigger that left the DOM", () => {
		const trigger = document.createElement("button");
		document.body.appendChild(trigger);
		trigger.focus();

		act(() => root.render(createElement(Panel, { open: true })));
		trigger.remove();

		act(() => root.render(createElement(Panel, { open: false })));
		assert.notEqual(document.activeElement, trigger);
	});

	it("wraps Tab off the last focusable back to the first", () => {
		act(() => root.render(createElement(Panel, { open: true })));
		buttonNamed("Second action").focus();

		const event = tab();

		assert.equal(event.defaultPrevented, true);
		assert.equal(document.activeElement, buttonNamed("First action"));
	});

	it("wraps Shift+Tab off the first focusable back to the last", () => {
		act(() => root.render(createElement(Panel, { open: true })));
		assert.equal(document.activeElement, buttonNamed("First action"));

		const event = tab(true);

		assert.equal(event.defaultPrevented, true);
		assert.equal(document.activeElement, buttonNamed("Second action"));
	});

	it("leaves Tab alone in the middle of the panel, so the browser moves on", () => {
		act(() => root.render(createElement(Panel, { open: true })));
		assert.equal(document.activeElement, buttonNamed("First action"));

		const event = tab();

		assert.equal(event.defaultPrevented, false);
	});

	it("pulls focus back in when Tab is pressed from outside the panel", () => {
		const outside = document.createElement("button");
		outside.textContent = "Behind the panel";
		document.body.appendChild(outside);

		act(() => root.render(createElement(Panel, { open: true })));
		outside.focus();

		const event = tab();

		assert.equal(event.defaultPrevented, true);
		assert.equal(document.activeElement, buttonNamed("First action"));
		outside.remove();
	});

	it("takes Shift+Tab from outside to the last focusable, not the first", () => {
		const outside = document.createElement("button");
		outside.textContent = "Behind the panel";
		document.body.appendChild(outside);

		act(() => root.render(createElement(Panel, { open: true })));
		outside.focus();

		tab(true);

		assert.equal(document.activeElement, buttonNamed("Second action"));
		outside.remove();
	});

	it("stops trapping once the panel closes", () => {
		const outside = document.createElement("button");
		outside.textContent = "Behind the panel";
		document.body.appendChild(outside);

		act(() => root.render(createElement(Panel, { open: true })));
		act(() => root.render(createElement(Panel, { open: false })));
		outside.focus();

		const event = tab();

		assert.equal(event.defaultPrevented, false);
		assert.equal(document.activeElement, outside);
		outside.remove();
	});

	it("holds Tab still when the panel has nothing to focus", () => {
		function Empty() {
			const ref = useRef<HTMLDivElement>(null);
			useModalFocus(ref, true);
			return createElement("div", { ref }, "nothing focusable here");
		}
		act(() => root.render(createElement(Empty)));

		const event = tab();

		assert.equal(event.defaultPrevented, true);
	});

	it("skips a disabled control when deciding where the edges are", () => {
		function WithDisabled() {
			const ref = useRef<HTMLDivElement>(null);
			useModalFocus(ref, true);
			return createElement(
				"div",
				{ ref },
				createElement("button", { type: "button" }, "First action"),
				createElement("button", { type: "button" }, "Second action"),
				createElement("button", { type: "button", disabled: true }, "Disabled"),
			);
		}
		act(() => root.render(createElement(WithDisabled)));
		buttonNamed("Second action").focus();

		const event = tab();

		assert.equal(event.defaultPrevented, true);
		assert.equal(document.activeElement, buttonNamed("First action"));
	});
});
