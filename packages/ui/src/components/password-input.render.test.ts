/**
 * The reveal toggle: it starts hidden, flips only the input's `type`, and
 * renames itself for the state it will produce next. Mounted against jsdom
 * since the toggle is internal state driven by a real click. React is imported
 * after the jsdom globals are installed so the controlled-input value tracker
 * binds to jsdom's prototypes.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import type {
	act as reactAct,
	createElement as reactCreateElement,
} from "react";
import type { Root, createRoot as reactCreateRoot } from "react-dom/client";
import type { PasswordInput as PasswordInputType } from "./password-input.js";

let dom: JSDOM;
let container: HTMLElement;
let root: Root;
let act: typeof reactAct;
let createElement: typeof reactCreateElement;
let createRoot: typeof reactCreateRoot;
let PasswordInput: typeof PasswordInputType;

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
	globalThis.Event = dom.window.Event;
	Object.defineProperty(globalThis, "navigator", {
		value: dom.window.navigator,
		configurable: true,
	});
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;

	const react = await import("react");
	act = react.act;
	createElement = react.createElement;
	({ createRoot } = await import("react-dom/client"));
	({ PasswordInput } = await import("./password-input.js"));
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

function field(): HTMLInputElement {
	return container.querySelector("input") as HTMLInputElement;
}

function toggle(): HTMLButtonElement {
	return container.querySelector("button") as HTMLButtonElement;
}

function click(button: HTMLButtonElement) {
	act(() => {
		button.click();
	});
}

describe("PasswordInput", () => {
	it("hides the value and offers to show it", () => {
		act(() => {
			root.render(createElement(PasswordInput, { id: "pw" }));
		});
		assert.equal(field().getAttribute("type"), "password");
		assert.equal(toggle().getAttribute("aria-label"), "Show password");
		assert.equal(toggle().getAttribute("aria-pressed"), "false");
	});

	it("reveals the value and offers to hide it again", () => {
		act(() => {
			root.render(createElement(PasswordInput, { id: "pw" }));
		});
		click(toggle());
		assert.equal(field().getAttribute("type"), "text");
		assert.equal(toggle().getAttribute("aria-label"), "Hide password");
		assert.equal(toggle().getAttribute("aria-pressed"), "true");

		click(toggle());
		assert.equal(field().getAttribute("type"), "password");
		assert.equal(toggle().getAttribute("aria-label"), "Show password");
		assert.equal(toggle().getAttribute("aria-pressed"), "false");
	});

	it("is a button that never submits its form", () => {
		let submits = 0;
		act(() => {
			root.render(
				createElement(
					"form",
					{ onSubmit: () => submits++ },
					createElement(PasswordInput, { id: "pw" }),
				),
			);
		});
		assert.equal(toggle().getAttribute("type"), "button");
		click(toggle());
		assert.equal(submits, 0);
	});

	it("leaves the attributes password managers key off untouched", () => {
		act(() => {
			root.render(
				createElement(PasswordInput, {
					id: "pw",
					name: "password",
					autoComplete: "current-password",
					required: true,
				}),
			);
		});
		click(toggle());
		assert.equal(field().getAttribute("name"), "password");
		assert.equal(field().getAttribute("autocomplete"), "current-password");
		assert.equal(field().hasAttribute("required"), true);
	});

	it("does not take focus from the field", () => {
		act(() => {
			root.render(createElement(PasswordInput, { id: "pw" }));
		});
		assert.notEqual(dom.window.document.activeElement, toggle());
		assert.equal(toggle().hasAttribute("autofocus"), false);
	});
});
