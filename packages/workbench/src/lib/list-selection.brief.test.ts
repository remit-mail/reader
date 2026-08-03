/**
 * The prototype's brief under the triage keys. The brief narrows its rows below
 * the shell that hands them down — a category scope, the ten-row cap behind
 * "Show N more", a collapsed section — so the cursor, the count and select-all
 * have to answer for the rows on screen and no others (#582), and the keys the
 * triage layer owns have to reach it from the brief's rows (#584).
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import {
	type BriefCategoryFilter,
	MessageListPane,
	type ThreadCategory,
	type ThreadSection,
} from "@remit/ui";
import type { JSDOM } from "jsdom";
import React, { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { type ListTriage, useListTriage } from "./list-selection.js";

// The test loader transpiles the kit's `.tsx` with the classic JSX runtime,
// which reads a global `React` (see ReadingPaneEmpty.render.test.ts).
(globalThis as { React?: typeof React }).React = React;

const thread = (id: string, category: ThreadCategory) => ({
	id,
	accountId: "a1",
	fromName: "Priya Nair",
	fromEmail: "priya@example.com",
	subject: `Message ${id}`,
	snippet: "Can we move it to 2pm?",
	timeLabel: "8:15",
	category,
});

const run = (prefix: string, count: number, category: ThreadCategory) =>
	Array.from({ length: count }, (_, index) =>
		thread(`${prefix}${index + 1}`, category),
	);

/** Both sections run past the cap, as `Flows/DailyBrief` → `Filtered` does. */
const sections: ThreadSection[] = [
	{ id: "personal", label: "Personal", threads: run("p", 14, "personal") },
	{
		id: "newsletter",
		label: "Newsletter",
		threads: run("n", 12, "newsletter"),
	},
];

let dom: JSDOM;
let container: HTMLElement;
let root: Root;
let triage: ListTriage;
let selectCategory: (category: BriefCategoryFilter) => void;

function Harness() {
	const [briefCategory, setBriefCategory] =
		useState<BriefCategoryFilter>("all");
	selectCategory = setBriefCategory;
	triage = useListTriage(sections);
	return createElement(MessageListPane, {
		hideHeader: true,
		listTitle: "Daily brief",
		sections: triage.sections,
		briefFilters: true,
		briefFilter: { briefCategory, onSelectBriefCategory: setBriefCategory },
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

/** Let the pane's row observer report a change the last render made. */
const settle = async () => {
	await act(async () => {
		await Promise.resolve();
	});
};

const focused = (): EventTarget =>
	(dom.window.document.activeElement as unknown as EventTarget) ??
	dom.window.document.body;

const press = (
	key: string,
	init: KeyboardEventInit = {},
	target: EventTarget = focused(),
) => {
	act(() => {
		target.dispatchEvent(
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

const rows = (): HTMLElement[] =>
	Array.from(container.querySelectorAll<HTMLElement>("[data-message-id]"));

const rowIds = () => rows().map((row) => row.dataset.messageId);

const rowFor = (id: string): HTMLElement => {
	const found = rows().find((row) => row.dataset.messageId === id);
	assert.ok(found, `no row for ${id}`);
	return found;
};

const expander = (label: string): HTMLElement => {
	const found = Array.from(
		container.querySelectorAll<HTMLElement>("button"),
	).find((button) => button.textContent?.startsWith(label));
	assert.ok(found, `no control labelled ${label}`);
	return found;
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
	globalThis.SVGElement = dom.window.SVGElement;
	globalThis.MutationObserver = dom.window.MutationObserver;
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

describe("the prototype's brief keyboard", () => {
	it("takes only the rows the capped sections are showing with ⌘A", () => {
		assert.equal(rows().length, 20, "ten rows from each section");
		press("a", { metaKey: true });
		assert.deepEqual(selected(), rowIds().slice().sort());
		assert.equal(
			triage.selection.selectedCount,
			20,
			"the count names the rows on screen, not the six behind the expanders",
		);
		assert.equal(triage.allSelected, true);
	});

	it("reaches the rows an expander reveals once it is open", async () => {
		act(() => expander("Show 4 more").click());
		await settle();
		press("a", { metaKey: true });
		assert.equal(triage.selection.selectedCount, 24);
	});

	it("drops the rows a category takes off screen from the selection", async () => {
		for (const _ of [1, 2, 3]) {
			press("j");
			press("x");
		}
		assert.deepEqual(selected(), ["p1", "p2", "p3"]);

		act(() => selectCategory("newsletter"));
		await settle();

		assert.deepEqual(
			rowIds(),
			run("n", 12, "newsletter").map((t) => t.id),
			"a single category renders a flat list, uncapped",
		);
		assert.equal(
			triage.selection.selectedCount,
			0,
			"the count and the verbs give up the rows the scope took away",
		);
	});

	it("stops j at the last row on screen rather than stepping behind an expander", () => {
		for (let index = 0; index < 10; index += 1) press("j");
		assert.equal(triage.paneKeyboard.focusedId, "p10");

		press("j");
		assert.equal(
			triage.paneKeyboard.focusedId,
			"n1",
			"the cursor crosses to the next section's first row, not to capped p11",
		);
	});

	it("extends the selection with Shift+ArrowDown, as Shift+j does", () => {
		press("j");
		press("ArrowDown", { shiftKey: true });
		press("ArrowDown", { shiftKey: true });
		assert.deepEqual(selected(), ["p2", "p3"]);
		assert.equal(triage.paneKeyboard.focusedId, "p3");
	});

	it("keeps the focus ring and the cursor on one row", () => {
		press("j");
		assert.equal(triage.paneKeyboard.focusedId, "p1");
		assert.equal(dom.window.document.activeElement, rowFor("p1"));

		press("ArrowDown");
		assert.equal(triage.paneKeyboard.focusedId, "p2");
		assert.equal(dom.window.document.activeElement, rowFor("p2"));

		press("x");
		assert.deepEqual(selected(), ["p2"], "x ticks the row the ring is on");
	});
});
