/**
 * Mounted against jsdom rather than `renderToString`, since focus and clicks
 * need a real `document`. Enter-to-activate is the browser's own behaviour and
 * jsdom does not implement it for anchors; `detail-surface.stories.tsx` covers
 * that in Chromium.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import { act, createElement, type MouseEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NavLinkSurface } from "./nav-link-surface.js";

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
	globalThis.MouseEvent = dom.window.MouseEvent;
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

function mount(props: Parameters<typeof NavLinkSurface>[0]) {
	act(() => {
		root.render(createElement(NavLinkSurface, props, "Daily brief"));
	});
	const link = container.querySelector("a");
	assert.ok(link, "no anchor rendered");
	return link;
}

function click(target: Element, init: { metaKey?: boolean } = {}) {
	act(() => {
		target.dispatchEvent(
			new dom.window.MouseEvent("click", {
				bubbles: true,
				cancelable: true,
				...init,
			}),
		);
	});
}

describe("NavLinkSurface interaction", () => {
	it("puts a link with an href in the tab order", () => {
		const link = mount({ href: "/mail/brief" });
		link.focus();
		assert.equal(dom.window.document.activeElement, link);
	});

	it("keeps a link with no href out of the tab order", () => {
		const link = mount({});
		link.focus();
		assert.notEqual(dom.window.document.activeElement, link);
	});

	it("passes a modified click through with its modifier intact", () => {
		const seen: boolean[] = [];
		const link = mount({
			href: "/mail/brief",
			onClick: (event: MouseEvent<HTMLAnchorElement>) => {
				event.preventDefault();
				seen.push(event.metaKey);
			},
		});

		click(link);
		click(link, { metaKey: true });

		assert.deepEqual(seen, [false, true]);
	});

	it("adds no click handling of its own when the caller passes none", () => {
		const link = mount({ href: "/mail/brief" });
		const event = new dom.window.MouseEvent("click", {
			bubbles: true,
			cancelable: true,
		});
		act(() => {
			link.dispatchEvent(event);
		});
		assert.equal(event.defaultPrevented, false);
	});
});
