/**
 * The hook on a mounted component: `keymap-dispatch.test.ts` covers which
 * action a stroke resolves to, and what is left is the wiring — which handler
 * a real keydown reaches, what the `g …` window does across two presses, and
 * what the layer leaves bound after it is taken down.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TriageAction, TriageHandlers } from "./keymap.js";
import { useTriageKeyboard } from "./use-triage-keyboard.js";

let container: HTMLElement;
let root: Root;
let fired: TriageAction[];

const handlers = (): TriageHandlers => ({
	focusNext: () => fired.push("focusNext"),
	toggleSelect: () => fired.push("toggleSelect"),
	selectAll: () => fired.push("selectAll"),
	goInbox: () => fired.push("goInbox"),
	back: () => fired.push("back"),
});

function Harness({ enabled }: { enabled: boolean }) {
	useTriageKeyboard({ handlers: handlers(), enabled });
	return createElement("input", { id: "field" });
}

const mount = (enabled = true) => {
	act(() => {
		root.render(createElement(Harness, { enabled }));
	});
};

const press = (
	key: string,
	init: KeyboardEventInit = {},
	target: EventTarget = document.body,
): KeyboardEvent => {
	const event = new KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
		...init,
	});
	act(() => {
		target.dispatchEvent(event);
	});
	return event as unknown as KeyboardEvent;
};

beforeEach(() => {
	fired = [];
	container = document.getElementById("root") as unknown as HTMLElement;
	container.innerHTML = "";
	root = createRoot(container);
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
});

describe("useTriageKeyboard", () => {
	it("routes a stroke to the handler its action names", () => {
		mount();
		press("j");
		assert.deepEqual(fired, ["focusNext"]);
	});

	it("takes the browser's default off a stroke it serves", () => {
		mount();
		assert.equal(press("j").defaultPrevented, true);
	});

	it("leaves a stroke no handler serves to the browser", () => {
		mount();
		assert.equal(press("r").defaultPrevented, false);
		assert.deepEqual(fired, []);
	});

	it("carries a go-to prefix across two strokes", () => {
		mount();
		press("g");
		press("i");
		assert.deepEqual(fired, ["goInbox"]);
	});

	it("drops the prefix once the sequence resolves", () => {
		mount();
		press("g");
		press("i");
		press("i");
		assert.deepEqual(fired, ["goInbox"]);
	});

	it("stays inert while focus is in an editable surface", () => {
		mount();
		const field = document.getElementById("field");
		assert.ok(field);
		press("j", {}, field);
		assert.deepEqual(fired, []);
	});

	it("claims ⌘A from the browser's select-all", () => {
		mount();
		assert.equal(press("a", { metaKey: true }).defaultPrevented, true);
		assert.deepEqual(fired, ["selectAll"]);
	});

	it("binds nothing while disabled", () => {
		mount(false);
		press("j");
		assert.deepEqual(fired, []);
	});

	it("releases the keyboard when it comes down", () => {
		mount();
		act(() => {
			root.unmount();
		});
		press("j");
		assert.deepEqual(fired, []);
		root = createRoot(container);
	});
});
