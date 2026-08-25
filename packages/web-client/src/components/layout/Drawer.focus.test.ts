/**
 * The drawer's focus trap (#747).
 *
 * The drawer is `aria-modal`, so a screen reader offers nothing outside it and
 * the scrim puts everything outside it out of a pointer's reach. Tab has to
 * agree with both: it cycles inside the drawer, and the ring is the controls a
 * reader can actually see and press — not every element that happens to match
 * a focusable selector.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
	act,
	createElement,
	Fragment,
	type ReactElement,
	type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { Drawer } from "./Drawer";

let container: HTMLElement;
let root: Root;
let outside: HTMLButtonElement;

const press = (key: string, shiftKey = false): void => {
	act(() => {
		document.dispatchEvent(
			new KeyboardEvent("keydown", { key, shiftKey, bubbles: true }),
		);
	});
};

const named = (label: string): HTMLElement => {
	const found = container.querySelector<HTMLElement>(`[data-name="${label}"]`);
	if (!found) throw new Error(`expected an element named ${label}`);
	return found;
};

const closeButton = (): HTMLElement => {
	const buttons = container.querySelectorAll<HTMLElement>(
		'.safe-area-frame [aria-label="Close menu"]',
	);
	const found = buttons[0];
	if (!found) throw new Error("expected the drawer's close button");
	return found;
};

const render = (isOpen: boolean, children: ReactNode): void => {
	act(() => {
		root.render(
			createElement(Drawer, {
				isOpen,
				onClose: () => undefined,
				ariaLabel: "Message details",
				side: "right",
				children,
			}),
		);
	});
};

const open = (children: ReactNode): void => render(true, children);
const close = (): void => render(false, null);

const button = (
	name: string,
	props: Record<string, unknown> = {},
): ReactElement =>
	createElement(
		"button",
		{ key: name, type: "button", "data-name": name, ...props },
		name,
	);

beforeEach(() => {
	container = document.getElementById("root") as unknown as HTMLElement;
	container.innerHTML = "";
	outside = document.createElement("button");
	outside.type = "button";
	outside.textContent = "Toolbar toggle";
	document.body.appendChild(outside);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	outside.remove();
});

describe("Drawer keeps Tab inside itself", () => {
	it("wraps backwards from the first element to the last", () => {
		open(createElement(Fragment, null, button("alpha"), button("omega")));
		closeButton().focus();

		press("Tab", true);

		assert.equal(document.activeElement, named("omega"));
	});

	it("wraps forwards from the last element to the first", () => {
		open(createElement(Fragment, null, button("alpha"), button("omega")));
		named("omega").focus();

		press("Tab");

		assert.equal(document.activeElement, closeButton());
	});

	it("pulls focus back in when it is somewhere else entirely", () => {
		open(createElement(Fragment, null, button("alpha")));
		outside.focus();

		press("Tab");

		assert.equal(document.activeElement, closeButton());
	});

	it("leaves an interior Tab to the browser", () => {
		open(createElement(Fragment, null, button("alpha"), button("omega")));
		named("alpha").focus();

		press("Tab");

		assert.equal(document.activeElement, named("alpha"));
	});
});

describe("Drawer's ring is what a reader can reach", () => {
	it("skips a scrim that took itself out of the tab order", () => {
		open(
			createElement(
				Fragment,
				null,
				button("backdrop", { tabIndex: -1 }),
				button("omega"),
			),
		);
		named("omega").focus();

		press("Tab");

		assert.equal(document.activeElement, closeButton());
	});

	it("skips disabled, aria-disabled and hidden controls", () => {
		open(
			createElement(
				Fragment,
				null,
				button("omega"),
				button("off", { disabled: true }),
				button("stated-off", { "aria-disabled": "true" }),
				button("gone", { style: { display: "none" } }),
				button("inerted", { inert: true }),
			),
		);
		named("omega").focus();

		press("Tab");

		assert.equal(document.activeElement, closeButton());
	});

	/**
	 * The intelligence pane's reclassify dialog renders inside the drawer, over
	 * its panel. A ring scoped to the panel puts that dialog's Cancel last and
	 * keeps every control behind its backdrop in the cycle, so Tab walks onto
	 * buttons no pointer can reach — the very thing the trap exists to prevent.
	 */
	it("hands the ring to a modal opened inside it", () => {
		open(
			createElement(
				Fragment,
				null,
				button("under-the-backdrop"),
				createElement(
					"div",
					{
						key: "nested",
						role: "dialog",
						"aria-modal": "true",
						"aria-label": "Reclassify sender",
					},
					button("automated"),
					button("Cancel"),
				),
			),
		);
		named("Cancel").focus();

		press("Tab");

		assert.equal(document.activeElement, named("automated"));

		press("Tab", true);

		assert.equal(document.activeElement, named("Cancel"));
	});
});

describe("Drawer gives focus back on the way out", () => {
	it("returns it to whatever held it when the drawer went up", () => {
		outside.focus();
		open(createElement(Fragment, null, button("alpha")));
		assert.equal(document.activeElement, closeButton());

		close();

		assert.equal(document.activeElement, outside);
	});
});
