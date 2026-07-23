/**
 * NavSidebar arrow-key traversal (#143) — mounted against jsdom rather than
 * `renderToString`, since focus and keydown need a real `document`.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { NavAccount } from "./app-shell-types.js";
import { NavSidebar } from "./nav-sidebar.js";

const accounts: NavAccount[] = [
	{
		id: "acct-personal",
		label: "Personal",
		email: "person@example.com",
		mailboxes: [
			{ id: "personal-inbox", name: "Inbox", role: "inbox" },
			{ id: "personal-sent", name: "Sent", role: "sent" },
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

function navItems(): HTMLElement[] {
	return Array.from(
		container.querySelectorAll("button:not([disabled]), a[href]"),
	);
}

function mount(variant?: "desktop" | "drawer") {
	act(() => {
		root.render(
			createElement(NavSidebar, {
				accounts,
				selectedNavId: "personal-inbox",
				onSelectNav: () => undefined,
				variant,
			}),
		);
	});
}

describe("NavSidebar arrow-key traversal", () => {
	it("puts only the first entry in the tab order before anything is focused", () => {
		mount();
		const items = navItems();
		assert.ok(items.length > 3);
		assert.equal(items[0]?.tabIndex, 0);
		assert.ok(items.slice(1).every((el) => el.tabIndex === -1));
	});

	it("ArrowDown walks forward, ArrowUp walks back", () => {
		mount();
		const items = navItems();
		act(() => items[0]?.focus());
		act(() => pressKey(items[0] as Element, "ArrowDown"));
		assert.equal(dom.window.document.activeElement, items[1]);

		act(() => pressKey(items[1] as Element, "ArrowDown"));
		assert.equal(dom.window.document.activeElement, items[2]);

		act(() => pressKey(items[2] as Element, "ArrowUp"));
		assert.equal(dom.window.document.activeElement, items[1]);
	});

	it("End reaches the Settings footer and Home returns to the top", () => {
		mount();
		const items = navItems();
		act(() => items[0]?.focus());
		act(() => pressKey(items[0] as Element, "End"));
		const last = items[items.length - 1];
		assert.equal(dom.window.document.activeElement, last);
		assert.match(last?.textContent ?? "", /Settings/);

		act(() => pressKey(last as Element, "Home"));
		assert.equal(dom.window.document.activeElement, items[0]);
	});

	it("traverses the drawer variant too", () => {
		mount("drawer");
		const items = navItems();
		act(() => items[0]?.focus());
		act(() => pressKey(items[0] as Element, "ArrowDown"));
		assert.equal(dom.window.document.activeElement, items[1]);
	});

	it("leaves Left/Right to the browser", () => {
		mount();
		const items = navItems();
		act(() => items[0]?.focus());
		act(() => pressKey(items[0] as Element, "ArrowRight"));
		assert.equal(dom.window.document.activeElement, items[0]);
	});
});
