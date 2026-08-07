/**
 * The brief's cursor and selection reach the rows the brief is showing and no
 * others (#582). Its sections cap themselves at ten behind "Show N more",
 * collapse from their headers and narrow to a category, none of which the rows
 * the shell hands down record — so the count, ⌘A and j/k are checked here
 * against what is in the DOM.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { briefSectionsLong, briefUnseen } from "../fixtures/workspace.js";
import { MailShell } from "./mail-shell.js";

const DESKTOP_WIDTH = 1440;

const sections = briefSectionsLong();
const loadedIds = sections.flatMap((section) =>
	section.threads.map((t) => t.id),
);
const personalIds =
	sections
		.find((section) => section.id === "personal")
		?.threads.map((t) => t.id) ?? [];

let dom: JSDOM;
let container: HTMLElement;
let root: Root;

before(async () => {
	(globalThis as { React?: typeof React }).React = React;
	const { JSDOM: JSDOMCtor } = await import("jsdom");
	dom = new JSDOMCtor(
		"<!doctype html><html><body><div id=root></div></body></html>",
		{ url: "http://localhost/", pretendToBeVisual: true },
	);
	globalThis.window = dom.window as unknown as typeof globalThis.window;
	globalThis.document = dom.window.document;
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.Element = dom.window.Element;
	globalThis.MouseEvent = dom.window.MouseEvent;
	globalThis.MutationObserver = dom.window.MutationObserver;
	globalThis.AbortController = dom.window.AbortController;
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
	act(() => {
		root.render(
			createElement(MailShell, {
				width: DESKTOP_WIDTH,
				selectedNavId: "brief",
				listTitle: "Daily brief",
				unreadCount: briefUnseen,
				sections,
				briefFilters: true,
			}),
		);
	});
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
});

const rowElements = (): HTMLElement[] =>
	Array.from(container.querySelectorAll<HTMLElement>("[data-list-row]"));

/** The ids on screen, in the order they are on screen. */
const shownIds = (): string[] =>
	rowElements()
		.map((row) => row.dataset.messageId)
		.filter((id): id is string => id !== undefined);

const rowFor = (id: string): HTMLElement => {
	const found = rowElements().find((row) => row.dataset.messageId === id);
	assert.ok(found, `no row on screen for ${id}`);
	return found;
};

/**
 * The row the cursor is on, as the pane draws it: the list's single tab stop.
 * A cursor sitting on a row that is not rendered leaves no row holding it.
 */
const cursorRowId = (): string | undefined =>
	rowElements().find((row) => row.tabIndex === 0)?.dataset.messageId;

/** The rows showing as ticked, which is what a user can act on. */
const checkedIds = (): string[] =>
	rowElements()
		.filter((row) => row.querySelector('[aria-label="Deselect message"]'))
		.map((row) => row.dataset.messageId)
		.filter((id): id is string => id !== undefined);

const selectionLabel = (): string =>
	container.querySelector("[data-selection-count]")?.textContent ?? "";

const press = (key: string, init: KeyboardEventInit = {}) => {
	const target =
		(dom.window.document.activeElement as unknown as EventTarget | null) ??
		(dom.window.document.body as unknown as EventTarget);
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

// A section's cap and its collapse are the section's own state, so the layer
// hears about them from the DOM rather than from a render — an async act flushes
// the observer's microtask alongside React's own work.
const click = async (element: Element, metaKey = false) => {
	await act(async () => {
		element.dispatchEvent(
			new dom.window.MouseEvent("click", {
				bubbles: true,
				cancelable: true,
				metaKey,
			}),
		);
	});
};

const byLabel = (label: string): HTMLElement => {
	const found = container.querySelector(`[aria-label="${label}"]`);
	assert.ok(found, `no control labelled "${label}"`);
	return found as HTMLElement;
};

const pill = (group: string, text: string): HTMLElement => {
	const row = container.querySelector(`[aria-label="${group}"]`);
	assert.ok(row, `the panel has no "${group}" row`);
	const found = Array.from(row.querySelectorAll("button")).find((node) =>
		(node.textContent ?? "").trim().startsWith(text),
	);
	assert.ok(found, `no ${group} pill reading "${text}"`);
	return found;
};

/** The list pane, so a control is never confused with the nav's namesake. */
const pane = (): HTMLElement => {
	const found = rowElements()[0]?.closest("section");
	assert.ok(found, "the list pane rendered no rows");
	return found as unknown as HTMLElement;
};

/** The first "Show N more" control, which the Personal section carries. */
const firstExpander = (): HTMLElement => {
	const found = Array.from(pane().querySelectorAll("button")).find((node) =>
		/^Show \d+ more/.test((node.textContent ?? "").trim()),
	);
	assert.ok(found, "no section on screen is capped");
	return found as HTMLElement;
};

/** A brief section's header, which is also its collapse toggle. */
const sectionHeader = (label: string): HTMLElement => {
	const found = Array.from(
		pane().querySelectorAll<HTMLElement>("button[aria-expanded]"),
	).find((node) => (node.textContent ?? "").trim().startsWith(label));
	assert.ok(found, `no "${label}" section header`);
	return found;
};

describe("the brief's ten-row cap", () => {
	it("keeps the rows behind it out of ⌘A", () => {
		const shown = shownIds();
		assert.ok(
			shown.length < loadedIds.length,
			"the fixture runs past the cap in at least one section",
		);

		press("a", { metaKey: true });

		assert.equal(
			selectionLabel(),
			`All ${shown.length} loaded selected`,
			"select-all counts the rows on screen, not the rows behind the expanders",
		);
	});

	it("keeps the rows behind it out of the cursor's reach", () => {
		const shown = shownIds();
		const shownPersonal = shown.filter((id) => personalIds.includes(id));
		assert.ok(
			shownPersonal.length < personalIds.length,
			"the personal section holds rows back behind its expander",
		);

		// Down to the last row above the cap, then one press past it.
		for (let step = 0; step < shownPersonal.length; step++) press("j");
		assert.equal(cursorRowId(), shownPersonal.at(-1));

		press("j");
		const nextOnScreen = shown[shownPersonal.length];
		assert.equal(
			cursorRowId(),
			nextOnScreen,
			"j off the last row above the cap lands on the next row on screen",
		);

		press("x");
		assert.deepEqual(
			checkedIds(),
			[nextOnScreen],
			"and x ticks the row the user can see the cursor on",
		);
		assert.equal(selectionLabel(), "1 message selected");
	});

	it("gives the rows back to the cursor when the expander opens", async () => {
		const before = shownIds();
		const hidden = personalIds.filter((id) => !before.includes(id));
		assert.ok(hidden.length > 0, "the personal section holds rows back");

		await click(firstExpander());

		const after = shownIds();
		for (const id of hidden) {
			assert.ok(after.includes(id), `${id} is on screen once expanded`);
		}

		press("a", { metaKey: true });
		assert.equal(selectionLabel(), `All ${after.length} loaded selected`);
	});
});

describe("the brief's category scope", () => {
	it("takes the rows it hides out of the selection", async () => {
		// The panel opens from the header the count takes over, so it goes up
		// before the rows are ticked, as it does for a user reaching the caret.
		await click(byLabel("Expand filters"));

		const ticked = shownIds()
			.filter((id) => personalIds.includes(id))
			.slice(0, 3);
		assert.equal(ticked.length, 3, "three personal rows are on screen");
		for (const id of ticked) await click(rowFor(id), true);
		assert.equal(selectionLabel(), "3 messages selected");

		await click(pill("Categories", "Newsletter"));

		assert.ok(
			shownIds().every((id) => !ticked.includes(id)),
			"no personal row survives the scope",
		);
		assert.equal(
			selectionLabel(),
			"",
			"and neither does the count, nor the verbs it carries",
		);
	});
});

describe("a collapsed brief section", () => {
	it("takes its rows out of the count and out of the keys", async () => {
		press("a", { metaKey: true });
		const beforeCollapse = shownIds().length;
		assert.equal(selectionLabel(), `All ${beforeCollapse} loaded selected`);

		await click(sectionHeader("Personal"));

		const afterCollapse = shownIds().length;
		assert.ok(afterCollapse < beforeCollapse, "the section gave up its rows");
		assert.equal(
			selectionLabel(),
			`All ${afterCollapse} loaded selected`,
			"a collapsed section's rows are not selected and not counted",
		);
	});
});
