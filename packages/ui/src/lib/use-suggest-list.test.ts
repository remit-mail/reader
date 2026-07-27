/**
 * use-suggest-list — drives the real hook on a jsdom-mounted input, because what
 * matters is the interaction between its state and the keystrokes the field
 * receives: an accepted suggestion, a dismissal that leaves the typed value
 * alone, a result set that changes under a stale highlight. The key rules
 * themselves are pure and tested in `suggest-keys.test.ts`.
 */

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSuggestList } from "./use-suggest-list.js";

let dom: JSDOM;
let container: HTMLElement;
let root: Root;

const accepted: string[] = [];

function Field(props: { options: string[] }) {
	const [value, setValue] = useState("typed");
	const suggest = useSuggestList({
		count: props.options.length,
		onAccept: (index) => accepted.push(props.options[index]),
	});
	return createElement("input", {
		id: "field",
		value,
		onChange: (event: { target: { value: string } }) => {
			suggest.reopen();
			setValue(event.target.value);
		},
		onKeyDown: suggest.handleKeyDown,
		"data-open": String(suggest.open),
		"data-active": String(suggest.activeIndex),
		...suggest.comboboxProps,
	});
}

function mount(options: string[]) {
	act(() => {
		root.render(createElement(Field, { options }));
	});
	const field = dom.window.document.getElementById("field");
	assert.ok(field, "field did not mount");
	// React's change-event polyfill tracks the focused input across keystrokes;
	// keys arriving at an unfocused field are not a state this ever sees.
	act(() => {
		(field as HTMLInputElement).focus();
	});
	return field;
}

function press(field: Element, key: string) {
	const event = new dom.window.KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
	});
	act(() => {
		field.dispatchEvent(event);
	});
	return event;
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
	globalThis.KeyboardEvent = dom.window.KeyboardEvent;
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

after(() => {
	dom.window.close();
});

beforeEach(() => {
	accepted.length = 0;
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

const OPTIONS = ["one", "two", "three"];

describe("useSuggestList", () => {
	it("opens only when there is something to suggest", () => {
		assert.equal(mount([]).getAttribute("data-open"), "false");
		assert.equal(mount(OPTIONS).getAttribute("data-open"), "true");
	});

	it("wires the combobox for a screen reader", () => {
		const field = mount(OPTIONS);
		assert.equal(field.getAttribute("role"), "combobox");
		assert.equal(field.getAttribute("aria-expanded"), "true");
		assert.equal(field.getAttribute("aria-autocomplete"), "list");
		assert.ok(field.getAttribute("aria-controls"));
		assert.equal(field.getAttribute("aria-activedescendant"), null);
	});

	it("points at the highlighted option once one is highlighted", () => {
		const field = mount(OPTIONS);
		press(field, "ArrowDown");
		assert.equal(field.getAttribute("data-active"), "0");
		assert.equal(
			field.getAttribute("aria-activedescendant"),
			`${field.getAttribute("aria-controls")}-option-0`,
		);
	});

	it("takes the highlighted suggestion on Enter and leaves Enter alone otherwise", () => {
		const field = mount(OPTIONS);
		const bare = press(field, "Enter");
		assert.deepEqual(accepted, []);
		assert.equal(bare.defaultPrevented, false, "the field's own Enter stands");

		press(field, "ArrowDown");
		press(field, "ArrowDown");
		press(field, "Enter");
		assert.deepEqual(accepted, ["two"]);
	});

	it("closes on Escape without touching what was typed, and owns the key while open", () => {
		const field = mount(OPTIONS);
		assert.equal(field.getAttribute("data-escape-owner"), "");
		press(field, "Escape");
		assert.equal(field.getAttribute("data-open"), "false");
		assert.equal(field.getAttribute("data-escape-owner"), null);
		assert.equal((field as HTMLInputElement).value, "typed");
	});

	it("leaves Escape to the surrounding surface once the list is closed", () => {
		const field = mount(OPTIONS);
		press(field, "Escape");
		const second = press(field, "Escape");
		assert.equal(second.defaultPrevented, false);
	});

	it("offers the list again for a changed result set, with no highlight carried over", () => {
		const field = mount(OPTIONS);
		press(field, "ArrowDown");
		press(field, "Escape");
		act(() => {
			root.render(createElement(Field, { options: ["only"] }));
		});
		assert.equal(field.getAttribute("data-open"), "true");
		assert.equal(field.getAttribute("data-active"), "-1");
	});
});
