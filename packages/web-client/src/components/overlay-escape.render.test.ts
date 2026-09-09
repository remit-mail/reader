/**
 * Escape on an open overlay closes the overlay and nothing else (#958), and no
 * other shortcut acts through one (#959).
 *
 * The window-level triage layer maps Escape to `back` — close the conversation,
 * or the list behind it — and `c` to compose. The client's three own overlays
 * used to let both reach it, so one Escape dismissed two things and `c` opened
 * compose out from under a modal. They share the kit's overlay stack now, and
 * the reading is the same for each: a listener on `window` never sees the key.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ConfirmDialog, useTriageKeyboard } from "@remit/ui";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Drawer } from "./layout/Drawer";
import { DropdownMenu, DropdownMenuItem } from "./ui/DropdownMenu";
import { KeyboardShortcutsModal } from "./ui/KeyboardShortcutsModal";

let root: Root;
let container: HTMLElement;
let seen: string[];
let listener: (event: KeyboardEvent) => void;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	seen = [];
	listener = (event) => seen.push(event.key);
	window.addEventListener("keydown", listener);
});

afterEach(() => {
	window.removeEventListener("keydown", listener);
	act(() => root.unmount());
	container.remove();
});

const render = (element: ReactNode) => {
	act(() => root.render(element));
};

const press = (key: string) => {
	act(() => {
		document.body.dispatchEvent(
			new window.KeyboardEvent("keydown", { key, bubbles: true }),
		);
	});
};

const assertScoped = (closed: number) => {
	assert.equal(closed, 1, "the overlay did not close itself");
	assert.deepEqual(seen, [], "the layer behind the overlay saw the same press");
};

describe("Escape is scoped to the overlay it lands on (#958)", () => {
	it("Drawer closes and swallows the key", () => {
		let closed = 0;
		render(
			createElement(Drawer, {
				isOpen: true,
				onClose: () => closed++,
				// biome-ignore lint/correctness/noChildrenProp: no JSX in a `.ts` test, and createElement's variadic children do not satisfy a required prop
				children: createElement("button", { type: "button" }, "Inbox"),
			}),
		);

		press("Escape");

		assertScoped(closed);
	});

	it("KeyboardShortcutsModal closes and swallows the key", () => {
		let closed = 0;
		render(
			createElement(KeyboardShortcutsModal, {
				isOpen: true,
				onClose: () => closed++,
			}),
		);

		press("Escape");

		assertScoped(closed);
	});

	it("DropdownMenu closes and swallows the key", () => {
		render(
			createElement(DropdownMenu, {
				trigger: "More",
				// biome-ignore lint/correctness/noChildrenProp: no JSX in a `.ts` test, and createElement's variadic children do not satisfy a required prop
				children: createElement(DropdownMenuItem, {
					onClick: () => undefined,
					// biome-ignore lint/correctness/noChildrenProp: same
					children: "Mark as read",
				}),
			}),
		);
		const trigger = container.querySelector("button") as HTMLButtonElement;
		act(() => trigger.click());
		assert.ok(container.textContent?.includes("Mark as read"));

		press("Escape");

		assert.equal(
			container.textContent?.includes("Mark as read"),
			false,
			"the menu did not close itself",
		);
		assert.deepEqual(seen, [], "the layer behind the menu saw the same press");
	});
});

/**
 * The route-level compose layer, mounted the way `/mail` mounts it: `c` off a
 * mailbox is served there and nowhere else, so on the brief and on Flagged it
 * was the only layer answering the key — and the only one with no guard.
 */
function ComposeLayer({
	modal,
	onCompose,
}: {
	modal: boolean;
	onCompose: () => void;
}) {
	useTriageKeyboard({ handlers: { compose: onCompose } });
	return createElement(ConfirmDialog, {
		isOpen: modal,
		title: "Delete 3 messages?",
		confirmLabel: "Delete",
		onConfirm: () => undefined,
		onCancel: () => undefined,
	});
}

describe("c under a confirmation on the brief (#959)", () => {
	it("stays inert while the dialog is up, and works once it is gone", () => {
		const composed: string[] = [];
		const onCompose = () => composed.push("c");

		render(createElement(ComposeLayer, { modal: true, onCompose }));
		press("c");
		assert.deepEqual(composed, [], "c opened compose from under the dialog");

		render(createElement(ComposeLayer, { modal: false, onCompose }));
		press("c");
		assert.deepEqual(composed, ["c"], "c stayed dead after the dialog closed");
	});
});
