import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useInitialFocus } from "./use-initial-focus.js";

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
	useInitialFocus(ref, open);
	return createElement(
		"div",
		{ ref },
		createElement("span", null, "not focusable"),
		createElement("button", { type: "button" }, "First action"),
		createElement("button", { type: "button" }, "Second action"),
	);
}

describe("useInitialFocus", () => {
	it("focuses the first focusable descendant once open", () => {
		act(() => root.render(createElement(Panel, { open: true })));
		assert.equal(document.activeElement?.textContent, "First action");
	});

	it("leaves focus alone while closed", () => {
		act(() => root.render(createElement(Panel, { open: false })));
		assert.notEqual(document.activeElement?.textContent, "First action");
	});
});
