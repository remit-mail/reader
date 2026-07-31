/**
 * The touch list renders the `sections` it is handed, on every render.
 *
 * It used to copy them into state on mount, so a consumer whose verbs act on
 * its own rows — the selection bar's Trash — cleared the bar and left every
 * row on screen. The swipe mock still has to work, so what it does is held as
 * ids over whatever the consumer passes rather than as a copy of the rows.
 */

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ThreadSection } from "./app-shell-types.js";
import { TouchListBody } from "./touch-list.js";

let dom: JSDOM;
let container: HTMLElement;
let root: Root;

const row = (id: string, fromName: string) => ({
	id,
	accountId: "account-1",
	fromName,
	fromEmail: `${id}@example.com`,
	subject: `Subject ${id}`,
	snippet: "…",
	timeLabel: "9:42",
	isRead: false,
});

const sectionsOf = (...ids: string[]): ThreadSection[] => [
	{ id: "inbox", threads: ids.map((id) => row(id, `Sender ${id}`)) },
];

const render = (sections: ThreadSection[]) => {
	act(() => {
		root.render(
			createElement(TouchListBody, {
				sections,
				selectionMode: false,
				checkedIds: new Set<string>(),
				onToggleCheck: () => undefined,
				onEnterSelection: () => undefined,
				onOpenThread: () => undefined,
				onRefresh: () => undefined,
				refreshing: false,
			}),
		);
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
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
});

describe("TouchListBody", () => {
	it("drops the rows a consumer's verb removed", () => {
		render(sectionsOf("a", "b", "c"));
		assert.match(container.textContent ?? "", /Sender a/);

		render(sectionsOf("c"));
		assert.doesNotMatch(container.textContent ?? "", /Sender a/);
		assert.doesNotMatch(container.textContent ?? "", /Sender b/);
		assert.match(container.textContent ?? "", /Sender c/);
	});

	it("shows the rows a consumer added after mount", () => {
		render(sectionsOf("a"));
		render(sectionsOf("a", "b"));
		assert.match(container.textContent ?? "", /Sender b/);
	});
});
