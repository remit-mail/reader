import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useModalFocus } from "./use-modal-focus.js";

let root: Root;

beforeEach(() => {
	const container = document.getElementById("root") as unknown as HTMLElement;
	container.innerHTML = "";
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
});

function Panel({ open }: { open: boolean }) {
	const ref = useRef<HTMLDivElement>(null);
	useModalFocus(ref, open);
	return createElement(
		"div",
		{ ref },
		createElement("span", null, "not focusable"),
		createElement("button", { type: "button" }, "First action"),
		createElement("button", { type: "button" }, "Second action"),
	);
}

const tab = (shiftKey = false): KeyboardEvent => {
	const event = new KeyboardEvent("keydown", {
		key: "Tab",
		shiftKey,
		bubbles: true,
		cancelable: true,
	});
	(document.activeElement ?? document).dispatchEvent(event);
	return event;
};

const buttonNamed = (name: string): HTMLElement => {
	const match = Array.from(document.querySelectorAll("button")).find(
		(el) => el.textContent === name,
	);
	assert.ok(match, `no button named ${name}`);
	return match;
};

describe("useModalFocus", () => {
	it("focuses the first focusable descendant once open", () => {
		act(() => root.render(createElement(Panel, { open: true })));
		assert.equal(document.activeElement?.textContent, "First action");
	});

	it("leaves focus on the body while closed", () => {
		act(() => root.render(createElement(Panel, { open: false })));
		assert.equal(document.activeElement, document.body);
	});

	it("moves focus in when an already-mounted panel opens", () => {
		act(() => root.render(createElement(Panel, { open: false })));
		assert.equal(document.activeElement, document.body);

		act(() => root.render(createElement(Panel, { open: true })));
		assert.equal(document.activeElement?.textContent, "First action");
	});

	it("returns focus to the trigger once the panel closes", () => {
		const trigger = document.createElement("button");
		trigger.textContent = "Open panel";
		document.body.appendChild(trigger);
		trigger.focus();
		assert.equal(document.activeElement, trigger);

		act(() => root.render(createElement(Panel, { open: true })));
		assert.equal(document.activeElement?.textContent, "First action");

		act(() => root.render(createElement(Panel, { open: false })));
		assert.equal(document.activeElement, trigger);

		trigger.remove();
	});

	it("does not throw restoring focus to a trigger that left the DOM", () => {
		const trigger = document.createElement("button");
		document.body.appendChild(trigger);
		trigger.focus();

		act(() => root.render(createElement(Panel, { open: true })));
		trigger.remove();

		act(() => root.render(createElement(Panel, { open: false })));
		assert.notEqual(document.activeElement, trigger);
	});

	it("wraps Tab off the last focusable back to the first", () => {
		act(() => root.render(createElement(Panel, { open: true })));
		buttonNamed("Second action").focus();

		const event = tab();

		assert.equal(event.defaultPrevented, true);
		assert.equal(document.activeElement, buttonNamed("First action"));
	});

	it("wraps Shift+Tab off the first focusable back to the last", () => {
		act(() => root.render(createElement(Panel, { open: true })));
		assert.equal(document.activeElement, buttonNamed("First action"));

		const event = tab(true);

		assert.equal(event.defaultPrevented, true);
		assert.equal(document.activeElement, buttonNamed("Second action"));
	});

	it("leaves Tab alone in the middle of the panel, so the browser moves on", () => {
		act(() => root.render(createElement(Panel, { open: true })));
		assert.equal(document.activeElement, buttonNamed("First action"));

		const event = tab();

		assert.equal(event.defaultPrevented, false);
	});

	/**
	 * An error banner and the fatal-error overlay paint above every modal from
	 * outside its subtree, and a trap that reclaims every Tab strands them
	 * (#970). Focus already outside the surface is somebody else's.
	 */
	it("leaves focus outside the panel alone", () => {
		const outside = document.createElement("button");
		outside.textContent = "Behind the panel";
		document.body.appendChild(outside);

		act(() => root.render(createElement(Panel, { open: true })));
		outside.focus();

		const event = tab();

		assert.equal(event.defaultPrevented, false);
		assert.equal(document.activeElement, outside);
		outside.remove();
	});

	it("leaves focus outside the panel alone on Shift+Tab too", () => {
		const outside = document.createElement("button");
		outside.textContent = "Behind the panel";
		document.body.appendChild(outside);

		act(() => root.render(createElement(Panel, { open: true })));
		outside.focus();

		const event = tab(true);

		assert.equal(event.defaultPrevented, false);
		assert.equal(document.activeElement, outside);
		outside.remove();
	});

	it("stops trapping once the panel closes", () => {
		const outside = document.createElement("button");
		outside.textContent = "Behind the panel";
		document.body.appendChild(outside);

		act(() => root.render(createElement(Panel, { open: true })));
		act(() => root.render(createElement(Panel, { open: false })));
		outside.focus();

		const event = tab();

		assert.equal(event.defaultPrevented, false);
		assert.equal(document.activeElement, outside);
		outside.remove();
	});

	/**
	 * The self-update overlay has no control to offer and still has to stop the
	 * keyboard: focus rests on the surface itself and Tab moves nowhere.
	 */
	it("holds Tab still when the panel has nothing to focus", () => {
		function Empty() {
			const ref = useRef<HTMLDivElement>(null);
			useModalFocus(ref, true);
			return createElement(
				"div",
				{ ref, tabIndex: -1 },
				"nothing focusable here",
			);
		}
		act(() => root.render(createElement(Empty)));
		assert.equal(document.activeElement?.textContent, "nothing focusable here");

		const event = tab();

		assert.equal(event.defaultPrevented, true);
		assert.equal(document.activeElement?.textContent, "nothing focusable here");
	});

	it("skips a disabled control when deciding where the edges are", () => {
		function WithDisabled() {
			const ref = useRef<HTMLDivElement>(null);
			useModalFocus(ref, true);
			return createElement(
				"div",
				{ ref },
				createElement("button", { type: "button" }, "First action"),
				createElement("button", { type: "button" }, "Second action"),
				createElement("button", { type: "button", disabled: true }, "Disabled"),
			);
		}
		act(() => root.render(createElement(WithDisabled)));
		buttonNamed("Second action").focus();

		const event = tab();

		assert.equal(event.defaultPrevented, true);
		assert.equal(document.activeElement, buttonNamed("First action"));
	});

	/**
	 * A control the eye cannot see is not the surface's last one: leaving it in
	 * the ring makes the wrap a no-op — `focus()` on a hidden element does
	 * nothing — and Tab walks out of the surface from there.
	 */
	it("skips controls a reader cannot see or press", () => {
		function WithHidden() {
			const ref = useRef<HTMLDivElement>(null);
			useModalFocus(ref, true);
			return createElement(
				"div",
				{ ref },
				createElement("button", { type: "button" }, "First action"),
				createElement("button", { type: "button" }, "Second action"),
				createElement(
					"button",
					{ type: "button", "aria-disabled": "true" },
					"Stated off",
				),
				createElement("button", { type: "button", hidden: true }, "Hidden"),
				createElement(
					"button",
					{ type: "button", style: { display: "none" } },
					"Gone",
				),
				createElement(
					"button",
					{ type: "button", style: { visibility: "hidden" } },
					"Invisible",
				),
			);
		}
		act(() => root.render(createElement(WithHidden)));
		buttonNamed("Second action").focus();

		const event = tab();

		assert.equal(event.defaultPrevented, true);
		assert.equal(document.activeElement, buttonNamed("First action"));
	});

	/**
	 * A dialog raised over a surface that is already up takes the ring with it,
	 * so the ring stays what a pointer can reach.
	 */
	it("hands the ring to a modal opened inside the panel", () => {
		function WithNested() {
			const ref = useRef<HTMLDivElement>(null);
			useModalFocus(ref, true);
			return createElement(
				"div",
				{ ref },
				createElement("button", { type: "button" }, "Under the backdrop"),
				createElement(
					"div",
					{ role: "dialog", "aria-modal": "true", "aria-label": "Confirm" },
					createElement("button", { type: "button" }, "Confirm"),
					createElement("button", { type: "button" }, "Cancel"),
				),
			);
		}
		act(() => root.render(createElement(WithNested)));
		assert.equal(document.activeElement?.textContent, "Confirm");

		buttonNamed("Under the backdrop").focus();
		tab();

		assert.equal(document.activeElement?.textContent, "Confirm");

		buttonNamed("Cancel").focus();
		tab();

		assert.equal(document.activeElement?.textContent, "Confirm");
	});
});

/**
 * Two surfaces can be up at once — the narrow-width nav drawer with a dialog
 * raised over it (#1204) — and Tab belongs to the one on top. Listener order
 * says the opposite: the surface that registered first sees the key first, and
 * a trap that answers it drags focus out from under the dialog above it.
 */
describe("useModalFocus with a second surface above it", () => {
	function TwoSurfaces({ topOpen }: { topOpen: boolean }) {
		const under = useRef<HTMLDivElement>(null);
		const over = useRef<HTMLDivElement>(null);
		useModalFocus(under, true);
		useModalFocus(over, topOpen);
		return createElement(
			"div",
			null,
			createElement(
				"div",
				{ ref: under },
				createElement("button", { type: "button" }, "Drawer first"),
				createElement("button", { type: "button" }, "Drawer last"),
			),
			topOpen
				? createElement(
						"div",
						{ ref: over },
						createElement("button", { type: "button" }, "Dialog first"),
						createElement("button", { type: "button" }, "Dialog last"),
					)
				: null,
		);
	}

	it("wraps within the top surface and leaves the one under it silent", () => {
		act(() => root.render(createElement(TwoSurfaces, { topOpen: true })));
		assert.equal(document.activeElement?.textContent, "Dialog first");

		tab(true);

		assert.equal(document.activeElement?.textContent, "Dialog last");

		tab();

		assert.equal(document.activeElement?.textContent, "Dialog first");
	});

	it("keeps the surface underneath from wrapping at its own edge", () => {
		act(() => root.render(createElement(TwoSurfaces, { topOpen: true })));
		buttonNamed("Drawer last").focus();

		const event = tab();

		assert.equal(event.defaultPrevented, false);
		assert.equal(document.activeElement?.textContent, "Drawer last");
	});

	it("hands Tab back to the surface underneath once the top one closes", () => {
		act(() => root.render(createElement(TwoSurfaces, { topOpen: true })));
		act(() => root.render(createElement(TwoSurfaces, { topOpen: false })));
		buttonNamed("Drawer last").focus();

		const event = tab();

		assert.equal(event.defaultPrevented, true);
		assert.equal(document.activeElement?.textContent, "Drawer first");
	});

	/**
	 * The nested pair, where both surfaces contain the focused control and the
	 * outer one would otherwise answer first over a ring of its own.
	 */
	it("answers from the inner surface when one is nested in the other", () => {
		function Nested() {
			const outer = useRef<HTMLDivElement>(null);
			const inner = useRef<HTMLDivElement>(null);
			useModalFocus(outer, true);
			useModalFocus(inner, true);
			return createElement(
				"div",
				{ ref: outer },
				createElement("button", { type: "button" }, "Outer action"),
				createElement(
					"div",
					{ ref: inner },
					createElement("button", { type: "button" }, "Inner first"),
					createElement("button", { type: "button" }, "Inner last"),
				),
			);
		}
		act(() => root.render(createElement(Nested)));
		buttonNamed("Inner last").focus();

		tab();

		assert.equal(document.activeElement?.textContent, "Inner first");
	});
});
