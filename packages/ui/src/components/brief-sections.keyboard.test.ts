/**
 * BriefSections arrow-key traversal (#143) — mounted against jsdom rather than
 * `renderToString`, since focus and keydown need a real `document`.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { BriefFilterId } from "../lib/brief-filters.js";
import { LIST_ROW_SELECTOR } from "../lib/roving-focus.js";
import {
	type ListKeyboard,
	useListKeyboard,
} from "../lib/use-list-keyboard.js";
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

function pressKey(target: Element, key: string, shiftKey = false) {
	target.dispatchEvent(
		new KeyboardEvent("keydown", { key, bubbles: true, shiftKey }),
	);
}

const NO_CHIPS: ReadonlySet<BriefFilterId> = new Set();

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
				activeFilters: NO_CHIPS,
				onToggleFilter: () => undefined,
				onClearFilters: () => undefined,
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
		assert.equal(document.activeElement, items[2]);

		act(() => (items[2] as HTMLElement).click());
		assert.equal(selected, "t3");
	});

	it("ArrowUp walks back and Home returns to the first row", () => {
		mount();
		const items = rows();

		act(() => items[2]?.focus());
		act(() => pressKey(items[2] as Element, "ArrowUp"));
		assert.equal(document.activeElement, items[1]);

		act(() => pressKey(items[1] as Element, "Home"));
		assert.equal(document.activeElement, items[0]);
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
		assert.equal(document.activeElement, items[2]);
	});
});

let list: ListKeyboard | undefined;

function BriefUnderLayer() {
	const keyboard = useListKeyboard({
		isDesktop: true,
		initialFocusedId: "t1",
	});
	list = keyboard;
	return createElement(
		"div",
		{ ref: keyboard.keyboard.ref, tabIndex: -1 },
		createElement(BriefSections, {
			sections,
			Row: ComfortableRow,
			keyboard: keyboard.keyboard,
			onSelectThread: () => undefined,
			onSelectBriefCategory: () => undefined,
			activeFilters: NO_CHIPS,
			onToggleFilter: () => undefined,
			onClearFilters: () => undefined,
		}),
	);
}

function mountUnderLayer() {
	act(() => {
		root.render(createElement(BriefUnderLayer));
	});
}

function selectedIds(): string[] {
	return Array.from(list?.selection.selectedIds ?? []).sort();
}

describe("BriefSections under a keyboard layer", () => {
	it("Shift+ArrowDown extends the selection down the rows", () => {
		mountUnderLayer();
		const items = rows();

		act(() => items[0]?.focus());
		act(() => pressKey(items[0] as Element, "ArrowDown", true));
		act(() => pressKey(items[0] as Element, "ArrowDown", true));

		assert.deepEqual(selectedIds(), ["t2", "t3"]);
	});

	it("Shift+ArrowUp extends the selection back up the rows", () => {
		mountUnderLayer();
		const items = rows();

		act(() => items[0]?.focus());
		act(() => pressKey(items[0] as Element, "ArrowDown"));
		act(() => pressKey(items[0] as Element, "ArrowDown"));
		act(() => pressKey(items[0] as Element, "ArrowUp", true));
		act(() => pressKey(items[0] as Element, "ArrowUp", true));

		assert.deepEqual(selectedIds(), ["t1", "t2"]);
	});

	it("Shift+ArrowDown selects the rows Shift+J does", () => {
		mountUnderLayer();
		const items = rows();

		act(() => items[0]?.focus());
		act(() => pressKey(items[0] as Element, "j", true));
		act(() => pressKey(items[0] as Element, "j", true));

		assert.deepEqual(selectedIds(), ["t2", "t3"]);
	});

	it("hands the bare arrows to the layer instead of walking the rows itself", () => {
		mountUnderLayer();
		const items = rows();

		act(() => items[0]?.focus());
		act(() => pressKey(items[0] as Element, "ArrowDown"));

		assert.equal(list?.cursor.focusedMessageId, "t2");
	});
});
