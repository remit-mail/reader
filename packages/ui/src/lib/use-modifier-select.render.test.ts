/**
 * Modifier-click selection on a message row.
 *
 * The rule under test is that a modifier is an input signal, not a layout one:
 * shift, cmd and ctrl select a row at every window width, because they can only
 * come from a real keyboard. Gating them on the desktop media query is what left
 * a half-screen browser or a tablet opening the message instead of selecting it.
 *
 * A row is an `<a href>`, so what "selection took the press" means concretely is
 * that the browser's own gesture — new window, new tab, context menu — is
 * prevented, and the click the same gesture delivers is claimed rather than
 * opening the row on top of the selection.
 */

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import { act, createElement, type MouseEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { isModified, useModifierSelect } from "./use-modifier-select.js";
import type { SelectionModifiers } from "./use-selection.js";

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

interface Log {
	/** Every (messageId, modifiers) selection was offered. */
	offers: SelectionModifiers[];
	/** Clicks that reached the row's open handler. */
	opens: number;
}

interface ProbeProps {
	log: Log;
	/** Whether selection takes the press it is offered. */
	takes: boolean;
	/** A row with no selection at all — the reading pane's, for instance. */
	unselectable?: boolean;
}

const ROW = "[data-row]";

function Probe({ log, takes, unselectable }: ProbeProps) {
	const select = useModifierSelect(
		"m1",
		unselectable
			? undefined
			: (_messageId, modifiers) => {
					log.offers.push(modifiers);
					return takes;
				},
	);
	return createElement(
		"a",
		{
			// A fragment rather than a route: still an `<a href>`, which is what
			// makes a modified click a browser gesture, without jsdom trying to
			// navigate on the clicks the test deliberately leaves unclaimed.
			href: "#m1",
			"data-row": "",
			onMouseDown: select.onMouseDown,
			onContextMenu: select.onContextMenu,
			onClick: (e: MouseEvent) => {
				if (select.claimClick(e)) return;
				log.opens += 1;
			},
		},
		"Quarterly numbers are in",
	);
}

const mount = (props: ProbeProps, viewportWidth: number): void => {
	Object.defineProperty(dom.window, "innerWidth", {
		value: viewportWidth,
		configurable: true,
	});
	act(() => {
		root.render(createElement(Probe, props));
	});
};

const emptyLog = (): Log => ({ offers: [], opens: 0 });

/** Dispatches a real mouse event and answers whether the default was taken. */
const press = (
	type: "mousedown" | "click" | "contextmenu",
	init: MouseEventInit = {},
): boolean => {
	const event = new dom.window.MouseEvent(type, {
		bubbles: true,
		cancelable: true,
		button: 0,
		...init,
	});
	act(() => {
		container.querySelector(ROW)?.dispatchEvent(event);
	});
	return event.defaultPrevented;
};

/** The full gesture a browser delivers: the press, then the click after it. */
const gesture = (
	init: MouseEventInit,
): { pressTaken: boolean; clickTaken: boolean } => ({
	pressTaken: press("mousedown", init),
	clickTaken: press("click", init),
});

// Both single-pane tiers and the multi-pane one. The narrow widths are the
// regression: they used to fall through to the touch branch, which reads no
// modifiers at all.
const WIDTHS = [390, 800, 1280];

describe("useModifierSelect", () => {
	for (const width of WIDTHS) {
		it(`takes a shift-press for selection at ${width}px`, () => {
			const log = emptyLog();
			mount({ log, takes: true }, width);

			const { pressTaken, clickTaken } = gesture({ shiftKey: true });

			assert.deepEqual(log.offers, [
				{ shiftKey: true, metaKey: false, ctrlKey: false },
			]);
			assert.equal(pressTaken, true, "the browser's new-window gesture is off");
			assert.equal(clickTaken, true, "the click the gesture delivers is spent");
			assert.equal(
				log.opens,
				0,
				"the row does not open on top of the selection",
			);
		});

		it(`takes a cmd-press for selection at ${width}px`, () => {
			const log = emptyLog();
			mount({ log, takes: true }, width);

			const { pressTaken } = gesture({ metaKey: true });

			assert.deepEqual(log.offers, [
				{ shiftKey: false, metaKey: true, ctrlKey: false },
			]);
			assert.equal(pressTaken, true);
			assert.equal(log.opens, 0);
		});

		it(`leaves a plain click alone at ${width}px`, () => {
			const log = emptyLog();
			mount({ log, takes: true }, width);

			const { pressTaken, clickTaken } = gesture({});

			assert.deepEqual(log.offers, [], "a tap carries no modifier to read");
			assert.equal(pressTaken, false);
			assert.equal(clickTaken, false);
			assert.equal(log.opens, 1, "the row opens, as it always did");
		});
	}

	it("claims a modified click on its own, for engines that deliver no usable press", () => {
		const log = emptyLog();
		mount({ log, takes: true }, 390);

		const clickTaken = press("click", { metaKey: true });

		assert.equal(clickTaken, true);
		assert.equal(log.opens, 0);
		assert.deepEqual(log.offers, [
			{ shiftKey: false, metaKey: true, ctrlKey: false },
		]);
	});

	it("leaves the browser's gesture standing when selection declines the press", () => {
		const log = emptyLog();
		mount({ log, takes: false }, 1280);

		const { pressTaken, clickTaken } = gesture({ metaKey: true });

		assert.equal(pressTaken, false, "cmd-click still opens a new tab");
		assert.equal(clickTaken, false);
	});

	it("reads no modifier on a row that cannot be selected", () => {
		const log = emptyLog();
		mount({ log, takes: true, unselectable: true }, 1280);

		const { pressTaken, clickTaken } = gesture({ shiftKey: true });

		assert.equal(pressTaken, false);
		assert.equal(clickTaken, false);
		assert.deepEqual(log.offers, []);
	});

	it("ignores a press from any button but the primary one", () => {
		const log = emptyLog();
		mount({ log, takes: true }, 1280);

		const pressTaken = press("mousedown", { button: 2, ctrlKey: true });

		assert.equal(pressTaken, false, "a right-click keeps its context menu");
		assert.deepEqual(log.offers, []);
	});

	it("suppresses the context menu a ctrl-press already spent on selection", () => {
		const log = emptyLog();
		mount({ log, takes: true }, 1280);

		assert.equal(press("contextmenu", { ctrlKey: true }), true);
	});

	it("leaves a plain right-click its context menu", () => {
		const log = emptyLog();
		mount({ log, takes: true }, 1280);

		assert.equal(press("contextmenu", {}), false);
	});

	it("leaves the context menu alone on a row that cannot be selected", () => {
		const log = emptyLog();
		mount({ log, takes: true, unselectable: true }, 1280);

		assert.equal(press("contextmenu", { ctrlKey: true }), false);
	});
});

describe("isModified", () => {
	it("is true for any of the three keys a keyboard can add", () => {
		assert.equal(
			isModified({ shiftKey: true, metaKey: false, ctrlKey: false }),
			true,
		);
		assert.equal(
			isModified({ shiftKey: false, metaKey: true, ctrlKey: false }),
			true,
		);
		assert.equal(
			isModified({ shiftKey: false, metaKey: false, ctrlKey: true }),
			true,
		);
	});

	it("is false for the bare press a tap delivers", () => {
		assert.equal(
			isModified({ shiftKey: false, metaKey: false, ctrlKey: false }),
			false,
		);
	});
});
