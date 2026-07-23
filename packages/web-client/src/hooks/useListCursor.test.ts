/**
 * The shared list cursor (#149) — the roving keyboard cursor and multi-selection
 * every thread list drives. Mounted against jsdom rather than `renderToString`,
 * since the state only moves in response to real calls across renders.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { type ListCursor, useListCursor } from "./useListCursor";

const IDS = ["m1", "m2", "m3", "m4"];

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
	Object.defineProperty(globalThis, "navigator", {
		value: dom.window.navigator,
		configurable: true,
	});
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

/**
 * Mount the hook and hand back a live handle. Every read goes through
 * `current()` so a test never asserts against a stale render.
 */
function mountCursor(options: {
	orderedIds?: string[];
	isDesktop?: boolean;
	initialFocusedId?: string;
}): () => ListCursor {
	let latest: ListCursor | undefined;
	const Probe = () => {
		latest = useListCursor({
			orderedIds: options.orderedIds ?? IDS,
			isDesktop: options.isDesktop ?? true,
			initialFocusedId: options.initialFocusedId,
		});
		return null;
	};
	act(() => root.render(createElement(Probe)));
	return () => {
		if (!latest) throw new Error("cursor not mounted");
		return latest;
	};
}

describe("useListCursor — the roving cursor", () => {
	it("starts on the open thread and walks the list with next/previous", () => {
		const cursor = mountCursor({ initialFocusedId: "m2" });
		assert.equal(cursor().focusedMessageId, "m2");

		act(() => cursor().focusNext());
		assert.equal(cursor().focusedMessageId, "m3");

		act(() => cursor().focusPrevious());
		assert.equal(cursor().focusedMessageId, "m2");
	});

	it("starts at the top when nothing is focused yet", () => {
		const cursor = mountCursor({});
		assert.equal(cursor().focusedMessageId, undefined);

		act(() => cursor().focusNext());
		assert.equal(cursor().focusedMessageId, "m1");
	});

	it("clamps at both ends rather than wrapping", () => {
		const cursor = mountCursor({ initialFocusedId: "m1" });
		act(() => cursor().focusPrevious());
		assert.equal(cursor().focusedMessageId, "m1");

		act(() => cursor().focusLast());
		assert.equal(cursor().focusedMessageId, "m4");
		act(() => cursor().focusNext());
		assert.equal(cursor().focusedMessageId, "m4");

		act(() => cursor().focusFirst());
		assert.equal(cursor().focusedMessageId, "m1");
	});

	it("moves nothing when the list is empty", () => {
		const cursor = mountCursor({ orderedIds: [] });
		act(() => cursor().focusNext());
		act(() => cursor().focusLast());
		assert.equal(cursor().focusedMessageId, undefined);
	});

	it("asks for DOM focus on its own moves, not on a pointer move", () => {
		const cursor = mountCursor({ initialFocusedId: "m1" });
		act(() => cursor().focusNext());
		assert.equal(cursor().pendingDomFocusRef.current, "m2");
		assert.equal(cursor().cursorMovedByPointerRef.current, false);
	});
});

describe("useListCursor — selection", () => {
	it("x toggles the row under the cursor", () => {
		const cursor = mountCursor({ initialFocusedId: "m2" });
		act(() => cursor().toggleFocusedSelection());
		assert.deepEqual([...cursor().selection.selectedIds], ["m2"]);

		act(() => cursor().toggleFocusedSelection());
		assert.equal(cursor().selection.selectedCount, 0);
	});

	it("shift-extend moves the cursor and grows the range from the anchor", () => {
		const cursor = mountCursor({ initialFocusedId: "m2" });

		// The first press has no anchor yet, so the row it lands on becomes both
		// the anchor and the whole range.
		act(() => cursor().extendRangeDown());
		assert.deepEqual([...cursor().selection.selectedIds], ["m3"]);
		assert.equal(cursor().focusedMessageId, "m3");
		assert.equal(cursor().selection.anchorId, "m3");

		// Consecutive presses extend from that anchor.
		act(() => cursor().extendRangeDown());
		assert.deepEqual([...cursor().selection.selectedIds].sort(), ["m3", "m4"]);
		assert.equal(cursor().focusedMessageId, "m4");
		assert.equal(cursor().selection.anchorId, "m3");
	});

	it("shift-extend upward ranges back through the anchor", () => {
		const cursor = mountCursor({ initialFocusedId: "m4" });

		act(() => cursor().extendRangeUp());
		assert.deepEqual([...cursor().selection.selectedIds], ["m3"]);

		act(() => cursor().extendRangeUp());
		assert.deepEqual([...cursor().selection.selectedIds].sort(), ["m2", "m3"]);
		assert.equal(cursor().focusedMessageId, "m2");
	});

	it("at the last row, extending takes that row and the cursor stays", () => {
		const cursor = mountCursor({ initialFocusedId: "m4" });
		act(() => cursor().extendRangeDown());
		assert.deepEqual([...cursor().selection.selectedIds], ["m4"]);
		assert.equal(cursor().focusedMessageId, "m4");
	});

	it("select-all takes every row, and exiting clears it", () => {
		const cursor = mountCursor({});
		act(() => cursor().selectAllLoaded());
		assert.equal(cursor().selection.selectedCount, IDS.length);

		act(() => cursor().exitSelection());
		assert.equal(cursor().selection.selectedCount, 0);
	});

	it("runs the caller's teardown before clearing", () => {
		const order: string[] = [];
		let latest: ListCursor | undefined;
		const Probe = () => {
			latest = useListCursor({
				orderedIds: IDS,
				isDesktop: true,
				onExitSelection: () => order.push("teardown"),
			});
			return null;
		};
		act(() => root.render(createElement(Probe)));
		act(() => latest?.selectAllLoaded());
		act(() => latest?.exitSelection());
		assert.deepEqual(order, ["teardown"]);
		assert.equal(latest?.selection.selectedCount, 0);
	});
});

describe("useListCursor — mouse selection semantics", () => {
	it("shift-click ranges, cmd-click toggles, and both consume the click", () => {
		const cursor = mountCursor({ initialFocusedId: "m1" });

		let handled = false;
		act(() => {
			handled = cursor().handleRowSelect("m3", {
				shiftKey: true,
				metaKey: false,
				ctrlKey: false,
			});
		});
		assert.equal(handled, true);
		assert.deepEqual([...cursor().selection.selectedIds].sort(), [
			"m1",
			"m2",
			"m3",
		]);

		act(() => {
			handled = cursor().handleRowSelect("m4", {
				shiftKey: false,
				metaKey: true,
				ctrlKey: false,
			});
		});
		assert.equal(handled, true);
		assert.ok(cursor().selection.selectedIds.has("m4"));
	});

	it("a plain click collapses the selection and lets the row open", () => {
		const cursor = mountCursor({ initialFocusedId: "m1" });
		act(() => cursor().selectAllLoaded());

		let handled = true;
		act(() => {
			handled = cursor().handleRowSelect("m2", {
				shiftKey: false,
				metaKey: false,
				ctrlKey: false,
			});
		});
		assert.equal(handled, false, "navigation must proceed on a plain click");
		assert.equal(cursor().selection.selectedCount, 0);
	});
});

describe("useListCursor — the device branch", () => {
	it("is not in multi-select mode on desktop, whatever is selected", () => {
		const cursor = mountCursor({ isDesktop: true });
		act(() => cursor().selectAllLoaded());
		assert.equal(cursor().isMultiSelectMode, false);
	});

	it("enters multi-select mode on touch as soon as something is selected", () => {
		const cursor = mountCursor({ isDesktop: false });
		assert.equal(cursor().isMultiSelectMode, false);

		act(() => cursor().selection.select("m2"));
		assert.equal(cursor().isMultiSelectMode, true);
	});

	it("on touch, in multi-select mode, next/previous toggle instead of moving", () => {
		const cursor = mountCursor({ isDesktop: false, initialFocusedId: "m1" });
		act(() => cursor().selection.select("m1"));

		act(() => cursor().focusNext());
		assert.equal(
			cursor().focusedMessageId,
			"m1",
			"the cursor stays put in multi-select mode",
		);
		assert.deepEqual([...cursor().selection.selectedIds].sort(), ["m1", "m2"]);
	});
});
