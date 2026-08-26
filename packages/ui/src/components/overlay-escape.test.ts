/**
 * Escape on an open overlay closes the overlay and nothing else (#958).
 *
 * The window-level triage layer maps Escape to `back`, which closes the
 * conversation or the list underneath; each of these surfaces used to let the
 * press reach it, so one keystroke dismissed two things. They share one scoping
 * mechanism now, and the reading here is the same for all of them: a listener on
 * `window` never sees the key the overlay answered.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConfirmDialog } from "./confirm-dialog.js";
import { Dialog } from "./dialog.js";
import { PopoverMenu } from "./popover-menu.js";
import { SlidePanel, type SlidePanelProps } from "./slide-panel.js";

let root: Root;
let container: HTMLElement;
let seen: string[];
let listener: (event: KeyboardEvent) => void;

beforeEach(() => {
	container = document.getElementById("root") as unknown as HTMLElement;
	container.innerHTML = "";
	root = createRoot(container);
	seen = [];
	listener = (event) => seen.push(event.key);
	window.addEventListener("keydown", listener);
});

afterEach(() => {
	window.removeEventListener("keydown", listener);
	act(() => root.unmount());
});

const render = (element: ReactNode) => {
	act(() => root.render(element));
};

const pressEscape = () => {
	act(() => {
		document.body.dispatchEvent(
			new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	});
};

/** What the overlay under test did with the press, and what leaked past it. */
const assertScoped = (closed: number) => {
	assert.equal(closed, 1, "the overlay did not close itself");
	assert.deepEqual(seen, [], "the layer behind the overlay saw the same press");
};

describe("Escape is scoped to the overlay it lands on (#958)", () => {
	it("SlidePanel closes and swallows the key", () => {
		let closed = 0;
		render(
			createElement(
				SlidePanel,
				// createElement never folds the children argument into the props
				// type, so a component with required children needs the cast.
				{
					isOpen: true,
					onClose: () => {
						closed++;
					},
					title: "Add Account",
				} as SlidePanelProps,
				"panel body",
			),
		);

		pressEscape();

		assertScoped(closed);
	});

	it("Dialog closes and swallows the key", () => {
		let closed = 0;
		render(
			createElement(
				Dialog,
				{ open: true, onClose: () => closed++, title: "Folders" },
				"dialog body",
			),
		);

		pressEscape();

		assertScoped(closed);
	});

	it("ConfirmDialog closes and swallows the key", () => {
		let closed = 0;
		render(
			createElement(ConfirmDialog, {
				isOpen: true,
				title: "Delete 3 messages?",
				confirmLabel: "Delete",
				onConfirm: () => undefined,
				onCancel: () => closed++,
			}),
		);

		pressEscape();

		assertScoped(closed);
	});

	it("PopoverMenu closes and swallows the key", () => {
		render(
			createElement(PopoverMenu, {
				triggerLabel: "More actions",
				items: [
					{ key: "read", label: "Mark as read", onSelect: () => undefined },
				],
			}),
		);
		const trigger = container.querySelector("button") as HTMLButtonElement;
		act(() => trigger.click());
		assert.equal(trigger.getAttribute("aria-expanded"), "true");

		pressEscape();

		assert.equal(
			trigger.getAttribute("aria-expanded"),
			"false",
			"the menu did not close itself",
		);
		assert.deepEqual(seen, [], "the layer behind the menu saw the same press");
	});
});
