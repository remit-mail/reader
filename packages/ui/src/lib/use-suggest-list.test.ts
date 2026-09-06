/**
 * use-suggest-list — drives the real hook on a jsdom-mounted input, because what
 * matters is the interaction between its state and the keystrokes the field
 * receives: an accepted suggestion, a dismissal that leaves the typed value
 * alone, a result set that changes under a stale highlight. The key rules
 * themselves are pure and tested in `suggest-keys.test.ts`.
 */

import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSuggestList } from "./use-suggest-list.js";

let container: HTMLElement;
let root: Root;

const accepted: string[] = [];
const comboboxPropsRenders: unknown[] = [];
const handleKeyDownRenders: unknown[] = [];

function Field(props: { options: string[] }) {
	const [value, setValue] = useState("typed");
	const suggest = useSuggestList({
		count: props.options.length,
		onAccept: (index) => accepted.push(props.options[index]),
	});
	comboboxPropsRenders.push(suggest.comboboxProps);
	handleKeyDownRenders.push(suggest.handleKeyDown);
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

const typeInto = (field: Element, value: string) => {
	const setter = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set;
	act(() => {
		setter?.call(field, value);
		field.dispatchEvent(new Event("input", { bubbles: true }));
	});
};

function mount(options: string[]) {
	act(() => {
		root.render(createElement(Field, { options }));
	});
	const field = document.getElementById("field");
	assert.ok(field, "field did not mount");
	// React's change-event polyfill tracks the focused input across keystrokes;
	// keys arriving at an unfocused field are not a state this ever sees.
	act(() => {
		(field as HTMLInputElement).focus();
	});
	return field;
}

function press(field: Element, key: string) {
	const event = new KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
	});
	act(() => {
		field.dispatchEvent(event);
	});
	return event;
}

beforeEach(() => {
	accepted.length = 0;
	comboboxPropsRenders.length = 0;
	handleKeyDownRenders.length = 0;
	container = document.getElementById("root") as unknown as HTMLElement;
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

	it("keeps the same comboboxProps object across a keystroke that changes nothing about the list", () => {
		const field = mount(OPTIONS);
		const rendersBefore = comboboxPropsRenders.length;
		const before = comboboxPropsRenders.at(-1);
		typeInto(field, "typed!");
		assert.equal(
			(field as HTMLInputElement).value,
			"typed!",
			"the keystroke landed",
		);
		assert.ok(
			comboboxPropsRenders.length > rendersBefore,
			"the keystroke did not re-render, so stability was never put to the test",
		);
		assert.equal(
			comboboxPropsRenders.at(-1),
			before,
			"comboboxProps should be referentially stable across an idle re-render",
		);
	});

	it("keeps the same handleKeyDown across a changed onAccept and a changed list", () => {
		const field = mount(OPTIONS);
		const first = handleKeyDownRenders.at(-1);
		typeInto(field, "typed!");
		press(field, "ArrowDown");
		act(() => {
			root.render(createElement(Field, { options: ["only"] }));
		});
		assert.ok(
			handleKeyDownRenders.length > 1,
			"nothing re-rendered, so stability was never put to the test",
		);
		assert.ok(
			handleKeyDownRenders.every((handler) => handler === first),
			"handleKeyDown should be referentially stable, so an inline onAccept at the call site cannot defeat a memo downstream",
		);
	});

	// The handler is stable, so it must read the state a key arrives at rather
	// than the state it was bound in.
	it("still accepts from the list it is looking at, not the one it was bound to", () => {
		const field = mount(OPTIONS);
		act(() => {
			root.render(createElement(Field, { options: ["alpha", "beta"] }));
		});
		press(field, "ArrowDown");
		press(field, "ArrowDown");
		press(field, "Enter");
		assert.deepEqual(accepted, ["beta"]);
	});
});
