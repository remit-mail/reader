/**
 * Mounted against jsdom rather than `renderToString`, since focus and clicks
 * need a real `document`. Enter-to-activate is the browser's own behaviour and
 * jsdom does not implement it for anchors; `detail-surface.stories.tsx` covers
 * that in Chromium.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement, type MouseEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NavLinkSurface } from "./nav-link-surface.js";

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
			new MouseEvent("click", {
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
		assert.equal(document.activeElement, link);
	});

	it("keeps a link with no href out of the tab order", () => {
		const link = mount({});
		link.focus();
		assert.notEqual(document.activeElement, link);
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
		const event = new MouseEvent("click", {
			bubbles: true,
			cancelable: true,
		});
		act(() => {
			link.dispatchEvent(event);
		});
		assert.equal(event.defaultPrevented, false);
	});
});
