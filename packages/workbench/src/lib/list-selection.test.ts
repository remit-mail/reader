/**
 * The prototype's list under the keys its footer advertises. The stories are
 * where this UI is reviewed, so a key the hint bar offers has to move something
 * in the list the bar sits under, and the selection keys have to leave the same
 * state they leave in the app.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { MessageListPane, type ThreadSection } from "@remit/ui";
import type { JSDOM } from "jsdom";
import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { type ListTriage, useListTriage } from "./list-selection.js";

// The test loader transpiles the kit's `.tsx` with the classic JSX runtime,
// which reads a global `React` (see ReadingPaneEmpty.render.test.ts).
(globalThis as { React?: typeof React }).React = React;

const sections: ThreadSection[] = [
	{
		id: "today",
		label: "Today",
		threads: [
			{
				id: "t1",
				accountId: "a1",
				fromName: "Priya Nair",
				fromEmail: "priya@example.com",
				subject: "Design review tomorrow",
				snippet: "Can we move it to 2pm?",
				timeLabel: "8:15",
				category: "personal",
			},
			{
				id: "t2",
				accountId: "a1",
				fromName: "Alex Rivera",
				fromEmail: "alex@example.com",
				subject: "Q3 planning notes",
				snippet: "Notes from today.",
				timeLabel: "9:42",
				category: "personal",
			},
			{
				id: "t3",
				accountId: "a1",
				fromName: "The Weekly Brief",
				fromEmail: "hello@weekly.example",
				subject: "This week in product",
				snippet: "Five stories you missed.",
				timeLabel: "Thu",
				category: "newsletter",
			},
		],
	},
];

let dom: JSDOM;
let container: HTMLElement;
let root: Root;
let triage: ListTriage;

function Harness() {
	triage = useListTriage(sections);
	return createElement(MessageListPane, {
		listTitle: "Inbox",
		sections: triage.sections,
		flatList: true,
		listState: "ready",
		isDesktop: true,
		selection: triage.paneSelection,
		keyboard: triage.paneKeyboard,
	});
}

const mount = () => {
	act(() => {
		root.render(createElement(Harness));
	});
};

const press = (key: string, init: KeyboardEventInit = {}) => {
	act(() => {
		dom.window.document.body.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", {
				key,
				bubbles: true,
				cancelable: true,
				...init,
			}),
		);
	});
};

const selected = () => Array.from(triage.selection.selectedIds).sort();

const advertisedKeys = () =>
	Array.from(container.querySelectorAll("footer kbd")).map(
		(chip) => chip.textContent ?? "",
	);

const rowClasses = () =>
	Array.from(container.querySelectorAll("[data-list-row]")).map(
		(row) => row.className,
	);

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
	mount();
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
});

describe("the prototype's list keyboard", () => {
	it("advertises only the keys it answers", () => {
		const keys = advertisedKeys();
		assert.deepEqual(keys, ["j", "k"]);
		for (const key of keys) {
			act(() => {
				root.unmount();
			});
			root = createRoot(container);
			mount();
			press(key);
			assert.notEqual(
				triage.paneKeyboard.focusedId,
				undefined,
				`${key} moved nothing in the list its hint bar sits under`,
			);
		}
	});

	it("draws the cursor the keys move", () => {
		const before = rowClasses();
		press("j");
		const after = rowClasses();
		const moved = after.filter(
			(className, index) => className !== before[index],
		);
		assert.equal(moved.length, 1);
	});

	it("walks the rows with j and k", () => {
		press("j");
		press("j");
		assert.equal(triage.paneKeyboard.focusedId, "t2");
		press("k");
		assert.equal(triage.paneKeyboard.focusedId, "t1");
	});

	it("ticks the row under the cursor with x", () => {
		press("j");
		press("x");
		assert.deepEqual(selected(), ["t1"]);
	});

	it("ticks the row under the cursor with Space", () => {
		press("j");
		press(" ");
		assert.deepEqual(selected(), ["t1"]);
	});

	it("extends a range with Shift+j", () => {
		press("j");
		press("j", { shiftKey: true });
		press("j", { shiftKey: true });
		assert.deepEqual(selected(), ["t2", "t3"]);
	});

	it("extends a range with Shift+ArrowUp", () => {
		press("j");
		press("j");
		press("j");
		press("ArrowUp", { shiftKey: true });
		press("ArrowUp", { shiftKey: true });
		assert.deepEqual(selected(), ["t1", "t2"]);
	});

	it("takes every loaded row with ⌘A", () => {
		press("a", { metaKey: true });
		assert.deepEqual(selected(), ["t1", "t2", "t3"]);
	});

	it("gives the selection back with Esc", () => {
		press("a", { metaKey: true });
		press("Escape");
		assert.deepEqual(selected(), []);
	});
});
