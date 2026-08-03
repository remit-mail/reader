/**
 * The prototype's list under the keys its footer advertises. The stories are
 * where this UI is reviewed, so every key the hint bar offers has to do in
 * Storybook what it does in the app, and the keys are pressed here where a
 * reviewer presses them: on whatever the list has given focus to.
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

const thread = (id: string, subject: string) => ({
	id,
	accountId: "a1",
	fromName: "Priya Nair",
	fromEmail: "priya@example.com",
	subject,
	snippet: "Can we move it to 2pm?",
	timeLabel: "8:15",
	category: "personal" as const,
});

const sections: ThreadSection[] = [
	{
		id: "today",
		label: "Today",
		threads: [
			thread("t1", "Design review tomorrow"),
			thread("t2", "Q3 planning notes"),
			thread("t3", "This week in product"),
		],
	},
];

const narrowed: ThreadSection[] = [
	{ id: "today", label: "Today", threads: [thread("t1", "Design review")] },
];

let dom: JSDOM;
let container: HTMLElement;
let root: Root;
let triage: ListTriage;

function Harness({ rows }: { rows: ThreadSection[] }) {
	triage = useListTriage(rows);
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

const mount = (rows: ThreadSection[] = sections) => {
	act(() => {
		root.render(createElement(Harness, { rows }));
	});
};

/** Let the pane's row observer report a change the last render made. */
const settle = async () => {
	await act(async () => {
		await Promise.resolve();
	});
};

const remount = () => {
	act(() => {
		root.unmount();
	});
	root = createRoot(container);
	mount();
};

/** Where the list has put focus — the pane, or the row the cursor is on. */
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
	Array.from(container.querySelectorAll<HTMLElement>("[data-list-row]"));

const rowFor = (id: string): HTMLElement => {
	const found = rows().find((row) => row.dataset.messageId === id);
	assert.ok(found, `no row for ${id}`);
	return found;
};

const advertisedKeys = () =>
	Array.from(container.querySelectorAll("footer kbd")).map(
		(chip) => chip.textContent ?? "",
	);

/**
 * What each advertised key has to do to earn its place in the footer. A key
 * with no entry here is a key the bar offers and this suite cannot vouch for,
 * which fails on its own.
 */
const advertised: Record<string, () => void> = {
	j: () => {
		press("j");
		assert.equal(triage.paneKeyboard.focusedId, "t1");
		press("j");
		assert.equal(triage.paneKeyboard.focusedId, "t2");
	},
	k: () => {
		press("j");
		press("j");
		assert.equal(triage.paneKeyboard.focusedId, "t2");
		press("k");
		assert.equal(triage.paneKeyboard.focusedId, "t1");
	},
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

describe("the prototype's list keyboard", () => {
	it("does what every key it advertises says it does", () => {
		const keys = advertisedKeys();
		assert.ok(keys.length > 0, "the footer offers nothing at all");
		for (const key of keys) {
			const expectation = advertised[key];
			assert.ok(
				expectation,
				`the footer offers "${key}" and nothing serves it`,
			);
			remount();
			expectation();
		}
	});

	it("draws the cursor the keys move", () => {
		const before = rows().map((row) => row.className);
		press("j");
		const after = rows().map((row) => row.className);
		const moved = after.filter(
			(className, index) => className !== before[index],
		);
		assert.equal(moved.length, 1);
	});

	it("gives the cursor's row real focus, and the list one tab stop", () => {
		press("j");
		press("j");
		assert.equal(dom.window.document.activeElement, rowFor("t2"));
		assert.deepEqual(
			rows().map((row) => row.tabIndex),
			[-1, 0, -1],
		);
	});

	it("ticks the row under the cursor with x", () => {
		press("j");
		press("x");
		assert.deepEqual(selected(), ["t1"]);
	});

	it("ticks the row under the cursor with Space, from the row itself", () => {
		press("j");
		assert.equal(dom.window.document.activeElement, rowFor("t1"));
		press(" ", {}, rowFor("t1"));
		assert.deepEqual(
			selected(),
			["t1"],
			"Space on a focused row ticks it, as it does in the app",
		);
	});

	it("opens the row under the cursor with Enter, from the row itself", () => {
		press("j");
		const event = new dom.window.KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
		});
		act(() => {
			rowFor("t1").dispatchEvent(event);
		});
		assert.deepEqual(
			selected(),
			[],
			"Enter opens rather than ticks, and never both",
		);
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

	it("drops a ticked row that the rows it is handed no longer carry", async () => {
		press("a", { metaKey: true });
		assert.deepEqual(selected(), ["t1", "t2", "t3"]);
		mount(narrowed);
		await settle();
		assert.deepEqual(
			selected(),
			["t1"],
			"a verb acts on the rows that are still on screen",
		);
	});
});
