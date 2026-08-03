/**
 * A pane mounted inside a keyboard layer leaves that layer its keys, whether or
 * not the pane carries a layer of its own. The pane answers the question its
 * rows ask — "does a keyboard above own the arrows?" — and a pane that has no
 * keyboard is not an answer of "no": it is one more component between the layer
 * and the rows. Lowering the answer there hands the brief's rows their own
 * roving group back inside a layer still listening for Shift+↑/↓ (#584).
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ListKeyboardAbove } from "../lib/list-keyboard-above.js";
import type { ThreadSection } from "./app-shell-types.js";
import { MessageListPane } from "./message-list-pane.js";

const sections: ThreadSection[] = [
	{
		id: "personal",
		label: "Personal",
		threads: ["t1", "t2", "t3"].map((id) => ({
			id,
			accountId: "a1",
			fromName: "Priya Nair",
			fromEmail: "priya@example.com",
			subject: `Message ${id}`,
			snippet: "Can we move it to 2pm?",
			timeLabel: "8:15",
			category: "personal" as const,
		})),
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
	globalThis.SVGElement = dom.window.SVGElement;
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

/** A pane with no keyboard of its own, under a layer that has one. */
const mountUnderLayer = (briefFilters: boolean) => {
	act(() => {
		root.render(
			createElement(
				ListKeyboardAbove,
				{ value: true },
				createElement(MessageListPane, {
					hideHeader: true,
					listTitle: "Daily brief",
					sections,
					briefFilters,
					flatList: true,
					listState: "ready",
					isDesktop: true,
				}),
			),
		);
	});
};

const rowFor = (id: string): HTMLElement => {
	const row = container.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
	assert.ok(row, `no row for ${id}`);
	return row;
};

const pressOnRow = (id: string, key: string, init: KeyboardEventInit = {}) => {
	act(() => {
		rowFor(id).dispatchEvent(
			new dom.window.KeyboardEvent("keydown", {
				key,
				bubbles: true,
				cancelable: true,
				...init,
			}),
		);
	});
};

describe("a keyboard-less pane inside a keyboard layer", () => {
	for (const [name, briefFilters] of [
		["the brief's sections", true],
		["the flat list", false],
	] as const) {
		it(`lets ${name} pass the arrows up to the layer`, () => {
			const reached: string[] = [];
			mountUnderLayer(briefFilters);
			container.addEventListener("keydown", (event) => {
				const stroke = event as KeyboardEvent;
				reached.push(`${stroke.shiftKey ? "Shift+" : ""}${stroke.key}`);
			});

			act(() => rowFor("t1").focus());
			pressOnRow("t1", "ArrowDown", { shiftKey: true });
			pressOnRow("t1", "ArrowDown");

			assert.deepEqual(reached, ["Shift+ArrowDown", "ArrowDown"]);
			assert.equal(
				dom.window.document.activeElement,
				rowFor("t1"),
				"the rows walk no cursor of their own — the layer above owns it",
			);
		});
	}
});
