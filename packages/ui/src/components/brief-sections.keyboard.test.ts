/**
 * BriefSections arrow-key traversal (#143) — mounted against jsdom rather than
 * `renderToString`, since focus and keydown need a real `document`.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LIST_ROW_SELECTOR } from "../lib/roving-focus.js";
import type { ThreadSection } from "./app-shell-types.js";
import { BriefSections } from "./brief-sections.js";
import { ComfortableRow } from "./message-row.js";

const sections: ThreadSection[] = [
	{
		id: "personal",
		label: "Personal",
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
		],
	},
	{
		id: "newsletter",
		label: "Newsletter",
		threads: [
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
	globalThis.KeyboardEvent = dom.window.KeyboardEvent;
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

function pressKey(target: Element, key: string) {
	target.dispatchEvent(
		new dom.window.KeyboardEvent("keydown", { key, bubbles: true }),
	);
}

function rows(): HTMLElement[] {
	return Array.from(container.querySelectorAll(LIST_ROW_SELECTOR));
}

function mount(onSelectThread: (id: string) => void = () => undefined) {
	act(() => {
		root.render(
			createElement(BriefSections, {
				sections,
				Row: ComfortableRow,
				onSelectThread,
				onSelectBriefCategory: () => undefined,
			}),
		);
	});
}

describe("BriefSections arrow-key traversal", () => {
	it("puts only the first row in the tab order before anything is focused", () => {
		mount();
		const items = rows();
		assert.equal(items.length, 3);
		assert.equal(items[0]?.tabIndex, 0);
		assert.equal(items[1]?.tabIndex, -1);
		assert.equal(items[2]?.tabIndex, -1);
	});

	it("ArrowDown crosses a section boundary and Enter opens the row", () => {
		let selected: string | undefined;
		mount((id) => {
			selected = id;
		});
		const items = rows();

		act(() => items[0]?.focus());
		act(() => pressKey(items[0] as Element, "ArrowDown"));
		act(() => pressKey(items[1] as Element, "ArrowDown"));
		assert.equal(dom.window.document.activeElement, items[2]);

		act(() => (items[2] as HTMLElement).click());
		assert.equal(selected, "t3");
	});

	it("ArrowUp walks back and Home returns to the first row", () => {
		mount();
		const items = rows();

		act(() => items[2]?.focus());
		act(() => pressKey(items[2] as Element, "ArrowUp"));
		assert.equal(dom.window.document.activeElement, items[1]);

		act(() => pressKey(items[1] as Element, "Home"));
		assert.equal(dom.window.document.activeElement, items[0]);
	});

	it("steps over the section headers between rows", () => {
		mount();
		const headers = Array.from(
			container.querySelectorAll<HTMLElement>("button[aria-expanded]"),
		);
		assert.ok(headers.length > 0);
		const items = rows();

		act(() => items[1]?.focus());
		act(() => pressKey(items[1] as Element, "ArrowDown"));
		assert.equal(dom.window.document.activeElement, items[2]);
	});
});
