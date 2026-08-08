/**
 * The rendered rows are read from the DOM, so a list body that caps, collapses
 * or filters itself below its consumer still reports what it shows.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useRenderedRowIds } from "./use-rendered-row-ids.js";

let dom: JSDOM;
let container: HTMLElement;
let root: Root;
let rowIds: string[] | undefined;
let showRows: (ids: string[]) => void;

function Harness({ initialIds }: { initialIds: string[] }) {
	const [ids, setIds] = useState(initialIds);
	const [element, setElement] = useState<HTMLElement | null>(null);
	showRows = setIds;
	rowIds = useRenderedRowIds(element);
	return createElement(
		"div",
		{ ref: setElement },
		ids.map((id) =>
			createElement("button", {
				key: id,
				type: "button",
				"data-message-id": id,
			}),
		),
	);
}

const settle = async () => {
	await act(async () => {
		await Promise.resolve();
	});
};

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
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

after(() => dom.window.close());

beforeEach(() => {
	container = dom.window.document.getElementById(
		"root",
	) as unknown as HTMLElement;
	container.innerHTML = "";
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
});

const mount = (initialIds: string[]) => {
	act(() => {
		root.render(createElement(Harness, { initialIds }));
	});
};

describe("useRenderedRowIds", () => {
	it("reads the rows in document order", () => {
		mount(["m1", "m2", "m3"]);
		assert.deepEqual(rowIds, ["m1", "m2", "m3"]);
	});

	it("follows rows appearing and disappearing under it", async () => {
		mount(["m1", "m2"]);
		act(() => showRows(["m1", "m2", "m3", "m4"]));
		await settle();
		assert.deepEqual(rowIds, ["m1", "m2", "m3", "m4"]);

		act(() => showRows(["m3"]));
		await settle();
		assert.deepEqual(rowIds, ["m3"]);
	});

	it("says a mounted list showing nothing shows nothing", async () => {
		mount(["m1"]);
		act(() => showRows([]));
		await settle();
		assert.deepEqual(rowIds, []);
	});

	it("keeps the same array while the rows are unchanged", async () => {
		mount(["m1", "m2"]);
		const first = rowIds;
		act(() => showRows(["m1", "m2"]));
		await settle();
		assert.equal(rowIds, first);
	});
});
