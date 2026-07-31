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
import { afterEach, describe, it } from "node:test";
import type { SelectionModifiers } from "@remit/ui";
import { createElement, type MouseEvent } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { useModifierSelect } from "./useModifierSelect";

let harness: DomHarness | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
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

const mount = (props: ProbeProps, viewportWidth: number): DomHarness => {
	harness = createDomHarness({ viewportWidth });
	harness.render(createElement(Probe, props));
	return harness;
};

const emptyLog = (): Log => ({ offers: [], opens: 0 });

/** Dispatches a real mouse event and answers whether the default was taken. */
const press = (
	dom: DomHarness,
	type: "mousedown" | "click" | "contextmenu",
	init: MouseEventInit = {},
): boolean => {
	const event = new dom.window.MouseEvent(type, {
		bubbles: true,
		cancelable: true,
		button: 0,
		...init,
	});
	dom.dispatch(dom.query(ROW) as Element, event);
	return event.defaultPrevented;
};

/** The full gesture a browser delivers: the press, then the click after it. */
const gesture = (
	dom: DomHarness,
	init: MouseEventInit,
): { pressTaken: boolean; clickTaken: boolean } => ({
	pressTaken: press(dom, "mousedown", init),
	clickTaken: press(dom, "click", init),
});

// Both single-pane tiers and the multi-pane one. The narrow widths are the
// regression: they used to fall through to the touch branch, which reads no
// modifiers at all.
const WIDTHS = [390, 800, 1280];

describe("useModifierSelect", () => {
	for (const width of WIDTHS) {
		it(`takes a shift-press for selection at ${width}px`, () => {
			const log = emptyLog();
			const dom = mount({ log, takes: true }, width);

			const { pressTaken, clickTaken } = gesture(dom, { shiftKey: true });

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
			const dom = mount({ log, takes: true }, width);

			const { pressTaken } = gesture(dom, { metaKey: true });

			assert.deepEqual(log.offers, [
				{ shiftKey: false, metaKey: true, ctrlKey: false },
			]);
			assert.equal(pressTaken, true);
			assert.equal(log.opens, 0);
		});

		it(`leaves a plain click alone at ${width}px`, () => {
			const log = emptyLog();
			const dom = mount({ log, takes: true }, width);

			const { pressTaken, clickTaken } = gesture(dom, {});

			assert.deepEqual(log.offers, [], "a tap carries no modifier to read");
			assert.equal(pressTaken, false);
			assert.equal(clickTaken, false);
			assert.equal(log.opens, 1, "the row opens, as it always did");
		});
	}

	it("claims a modified click on its own, for engines that deliver no usable press", () => {
		const log = emptyLog();
		const dom = mount({ log, takes: true }, 390);

		const clickTaken = press(dom, "click", { metaKey: true });

		assert.equal(clickTaken, true);
		assert.equal(log.opens, 0);
		assert.deepEqual(log.offers, [
			{ shiftKey: false, metaKey: true, ctrlKey: false },
		]);
	});

	it("leaves the browser's gesture standing when selection declines the press", () => {
		const log = emptyLog();
		const dom = mount({ log, takes: false }, 1280);

		const { pressTaken, clickTaken } = gesture(dom, { metaKey: true });

		assert.equal(pressTaken, false, "cmd-click still opens a new tab");
		assert.equal(clickTaken, false);
	});

	it("reads no modifier on a row that cannot be selected", () => {
		const log = emptyLog();
		const dom = mount({ log, takes: true, unselectable: true }, 1280);

		const { pressTaken, clickTaken } = gesture(dom, { shiftKey: true });

		assert.equal(pressTaken, false);
		assert.equal(clickTaken, false);
		assert.deepEqual(log.offers, []);
	});

	it("ignores a press from any button but the primary one", () => {
		const log = emptyLog();
		const dom = mount({ log, takes: true }, 1280);

		const pressTaken = press(dom, "mousedown", { button: 2, ctrlKey: true });

		assert.equal(pressTaken, false, "a right-click keeps its context menu");
		assert.deepEqual(log.offers, []);
	});

	it("suppresses the context menu a ctrl-press already spent on selection", () => {
		const log = emptyLog();
		const dom = mount({ log, takes: true }, 1280);

		assert.equal(press(dom, "contextmenu", { ctrlKey: true }), true);
	});

	it("leaves a plain right-click its context menu", () => {
		const log = emptyLog();
		const dom = mount({ log, takes: true }, 1280);

		assert.equal(press(dom, "contextmenu", {}), false);
	});

	it("leaves the context menu alone on a row that cannot be selected", () => {
		const log = emptyLog();
		const dom = mount({ log, takes: true, unselectable: true }, 1280);

		assert.equal(press(dom, "contextmenu", { ctrlKey: true }), false);
	});
});
