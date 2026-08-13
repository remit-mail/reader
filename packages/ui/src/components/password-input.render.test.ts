/**
 * The reveal toggle: it starts hidden, flips only the input's `type`, and
 * renames itself for the state it will produce next. Mounted against jsdom
 * since the toggle is internal state driven by a real click.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PasswordInput } from "./password-input.js";

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
		assert.notEqual(document.activeElement, toggle());
		assert.equal(toggle().hasAttribute("autofocus"), false);
	});
});
