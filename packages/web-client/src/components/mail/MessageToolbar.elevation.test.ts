/**
 * The toolbar's intelligence toggle against the drawer that covers it (#747).
 *
 * The drawer is modal: one stacking context holding both its scrim and its
 * panel. A z-index on the toggle from outside that context clears the scrim
 * only by clearing the panel too, so the control ends up painted over the
 * drawer's content. What the toggle does instead is move — into the
 * drawer's elevation layer, which stands after the scrim and after the panel,
 * where DOM order is the whole rule. It must stand after the panel too: at
 * the widths where the reading pane is mounted the toggle's own slot lies
 * under the panel, so anything under it leaves the press on the drawer's
 * chrome.
 *
 * Mounted rather than rendered to a string: where the button ends up, and
 * whether the press reaches it, are facts about the tree and not about the
 * markup one component emits.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Drawer } from "@/components/layout/Drawer";
import { MessageToolbar } from "./MessageToolbar";

let container: HTMLElement;
let root: Root;

const toggle = (): HTMLElement => {
	const found = container.querySelector<HTMLElement>(
		'[aria-label$="intelligence sidebar"]',
	);
	if (!found) throw new Error("expected an intelligence toggle");
	return found;
};

const scrim = (): HTMLElement => {
	const found = container.querySelector<HTMLElement>(
		'[role="dialog"] > [aria-label="Close menu"]',
	);
	if (!found) throw new Error("expected the drawer scrim");
	return found;
};

const panel = (): HTMLElement => {
	const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
	const found = dialog?.querySelector<HTMLElement>(".safe-area-frame");
	if (!found) throw new Error("expected the drawer panel");
	return found;
};

const mount = (drawerOpen: boolean, onToggle: () => void): void => {
	act(() => {
		root.render(
			createElement(
				Fragment,
				null,
				createElement(MessageToolbar, {
					hasThread: true,
					intelligenceOpen: drawerOpen,
					canToggleIntelligence: true,
					intelligenceElevated: drawerOpen,
					onToggleIntelligence: onToggle,
				}),
				createElement(
					Drawer,
					{
						isOpen: drawerOpen,
						onClose: () => undefined,
						ariaLabel: "Message details",
						side: "right",
					},
					createElement("p", null, "Intelligence"),
				),
			),
		);
	});
};

beforeEach(() => {
	container = document.getElementById("root") as unknown as HTMLElement;
	container.innerHTML = "";
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
});

describe("the intelligence toggle against the drawer it opened (#747)", () => {
	it("sits in its own toolbar while no drawer is up", () => {
		mount(false, () => undefined);
		assert.equal(container.querySelector('[role="dialog"]'), null);
		assert.equal(toggle().closest('[role="dialog"]'), null);
	});

	it("moves into the drawer, after the scrim and after the panel", () => {
		const onToggle = () => undefined;
		mount(false, onToggle);
		mount(true, onToggle);

		const lifted = toggle();
		const dialog = lifted.closest('[role="dialog"]');
		assert.ok(dialog, "the toggle stands inside the drawer's own root");
		assert.ok(
			scrim().compareDocumentPosition(lifted) &
				Node.DOCUMENT_POSITION_FOLLOWING,
			"after the scrim, so the scrim cannot swallow the press",
		);
		assert.ok(
			panel().compareDocumentPosition(lifted) &
				Node.DOCUMENT_POSITION_FOLLOWING,
			"after the panel too: at the widths where the reading pane is mounted " +
				"the toggle's own slot lies under the panel, so anything under the " +
				"panel leaves the press on the drawer's chrome (#747)",
		);
	});

	it("keeps the same button, so the drawer's focus restore still finds it", () => {
		const onToggle = () => undefined;
		mount(false, onToggle);
		const before = toggle();
		mount(true, onToggle);
		assert.equal(toggle(), before);
		mount(false, onToggle);
		assert.equal(toggle(), before);
		assert.equal(before.isConnected, true);
	});

	it("has focus back on it once the drawer it opened is gone", () => {
		const onToggle = () => undefined;
		mount(false, onToggle);
		const pressed = toggle();
		pressed.focus();

		mount(true, onToggle);
		assert.notEqual(document.activeElement, pressed);

		mount(false, onToggle);
		assert.equal(document.activeElement, pressed);
	});

	it("closes the drawer when pressed through it", () => {
		let presses = 0;
		const onToggle = () => {
			presses += 1;
		};
		mount(false, onToggle);
		mount(true, onToggle);

		act(() => {
			toggle().click();
		});
		assert.equal(presses, 1);
	});

	it("leaves the toolbar's other verbs under the scrim", () => {
		mount(false, () => undefined);
		mount(true, () => undefined);
		const reply = container.querySelector<HTMLElement>('[aria-label="Reply"]');
		assert.ok(reply);
		assert.equal(reply.closest('[role="dialog"]'), null);
	});
});
