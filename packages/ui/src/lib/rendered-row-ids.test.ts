/**
 * The rows a list actually shows, read from the DOM.
 *
 * A section that caps itself at ten rows, collapses from its header, or is
 * narrowed by a filter chip changes what is on screen without the consumer's
 * data changing. This is what keeps a shift-range and a select-all inside what
 * the user can see, so the observer — not a render pass — is the subject here.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readRowIds, sameIds, useRenderedRowIds } from "./rendered-row-ids.js";

let dom: JSDOM;
let container: HTMLElement;
let root: Root;

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
	globalThis.MutationObserver = dom.window.MutationObserver;
	Object.defineProperty(globalThis, "navigator", {
		value: dom.window.navigator,
		configurable: true,
	});
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
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

/** Renders `ids` as rows and reports what the hook read back. */
function Probe({ ids, seen }: { ids: string[]; seen: string[][] }) {
	const listRef = useRef<HTMLDivElement>(null);
	const rowIds = useRenderedRowIds(listRef);
	seen.push(rowIds);
	return createElement(
		"div",
		{ ref: listRef },
		ids.map((id) =>
			createElement("button", {
				key: id,
				type: "button",
				"data-message-id": id,
			}),
		),
	);
}

const flush = async (): Promise<void> => {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
};

describe("readRowIds", () => {
	it("reads the ids in document order and skips anything without one", () => {
		container.innerHTML =
			'<div data-message-id="m1"></div><div></div><div data-message-id="m2"></div>';
		assert.deepEqual(readRowIds(container), ["m1", "m2"]);
	});
});

describe("sameIds", () => {
	it("is false when the order changed, not only the membership", () => {
		assert.equal(sameIds(["a", "b"], ["b", "a"]), false);
		assert.equal(sameIds(["a", "b"], ["a", "b"]), true);
		assert.equal(sameIds(["a"], ["a", "b"]), false);
	});
});

describe("useRenderedRowIds", () => {
	it("reads the rows already on screen at mount", async () => {
		const seen: string[][] = [];
		await act(async () => {
			root.render(createElement(Probe, { ids: ["m1", "m2", "m3"], seen }));
		});
		await flush();

		assert.deepEqual(seen.at(-1), ["m1", "m2", "m3"]);
	});

	it("follows rows leaving and joining the list", async () => {
		const seen: string[][] = [];
		await act(async () => {
			root.render(createElement(Probe, { ids: ["m1", "m2", "m3"], seen }));
		});
		await flush();

		await act(async () => {
			root.render(createElement(Probe, { ids: ["m1", "m3", "m4"], seen }));
		});
		await flush();

		assert.deepEqual(seen.at(-1), ["m1", "m3", "m4"]);
	});
});
