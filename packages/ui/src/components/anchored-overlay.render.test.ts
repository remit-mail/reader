/**
 * Regression cover for issue #601 — the folder dropdown was drawn inside the
 * reading pane, and the pane is `overflow: hidden`, so the panel was cut off at
 * the pane's edge and the thread list next to it took the space the dropdown
 * should have covered.
 *
 * The assertions are aimed at the cause rather than the picture: the panel is
 * not a descendant of the clipping pane, and it is positioned against the
 * trigger's viewport rect so it lands where the trigger is.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import type {
	act as reactAct,
	createElement as reactCreateElement,
	useState as reactUseState,
} from "react";
import type { Root, createRoot as reactCreateRoot } from "react-dom/client";
import type { AnchoredOverlay as AnchoredOverlayType } from "./anchored-overlay.js";

let dom: JSDOM;
let container: HTMLElement;
let root: Root;
let act: typeof reactAct;
let createElement: typeof reactCreateElement;
let useState: typeof reactUseState;
let createRoot: typeof reactCreateRoot;
let AnchoredOverlay: typeof AnchoredOverlayType;

const TRIGGER_RECT = {
	top: 40,
	bottom: 72,
	left: 620,
	right: 660,
	width: 40,
	height: 32,
	x: 620,
	y: 40,
	toJSON: () => ({}),
} as DOMRect;

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
	globalThis.Event = dom.window.Event;
	globalThis.MouseEvent = dom.window.MouseEvent;
	globalThis.KeyboardEvent = dom.window.KeyboardEvent;
	Object.defineProperty(globalThis, "navigator", {
		value: dom.window.navigator,
		configurable: true,
	});
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;

	const react = await import("react");
	act = react.act;
	createElement = react.createElement;
	useState = react.useState;
	({ createRoot } = await import("react-dom/client"));
	({ AnchoredOverlay } = await import("./anchored-overlay.js"));
});

after(() => dom.window.close());

beforeEach(() => {
	container = dom.window.document.createElement("div");
	dom.window.document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const panel = () =>
	dom.window.document.querySelector<HTMLElement>("[data-testid=panel]");

const clippingPane = () =>
	dom.window.document.querySelector<HTMLElement>("[data-testid=pane]");

/**
 * The shell's arrangement in miniature: a pane that clips its content, with the
 * trigger in its header. The trigger reports a fixed viewport rect — jsdom has
 * no layout of its own.
 */
const mount = async (
	options: { onDismiss?: () => void; rect?: DOMRect; panelHeight?: number } = {},
) => {
	const rect = options.rect ?? TRIGGER_RECT;
	const Harness = () => {
		const [anchor, setAnchor] = useState<HTMLElement | null>(null);
		const [open, setOpen] = useState(false);
		return createElement(
			"div",
			{ "data-testid": "pane", style: { overflow: "hidden" } },
			createElement("button", {
				type: "button",
				"data-testid": "trigger",
				ref: (element: HTMLButtonElement | null) => {
					if (element) {
						element.getBoundingClientRect = () => rect;
					}
					setAnchor(element);
				},
				onClick: () => setOpen((value) => !value),
			}),
			createElement(AnchoredOverlay, {
				anchor,
				open,
				onDismiss: () => {
					options.onDismiss?.();
					setOpen(false);
				},
				align: "end",
				className: "w-72",
				children: createElement(
					"div",
					{ "data-testid": "panel" },
					createElement("input", { "aria-label": "Filter folders" }),
				),
			}),
		);
	};
	await act(async () => root.render(createElement(Harness)));
	await act(async () => {
		dom.window.document
			.querySelector<HTMLElement>("[data-testid=trigger]")
			?.click();
	});
};

describe("AnchoredOverlay escapes the pane that clips it (#601)", () => {
	it("draws the panel outside the clipping pane", async () => {
		await mount();
		const open = panel();
		assert.ok(open, "the panel renders when open");
		assert.equal(
			clippingPane()?.contains(open),
			false,
			"an overflow-hidden ancestor would cut the panel off",
		);
		assert.equal(open.parentElement?.parentElement, dom.window.document.body);
	});

	it("positions the panel against the trigger's viewport rect", async () => {
		await mount();
		const positioned = panel()?.parentElement as HTMLElement;
		assert.equal(positioned.style.top, `${TRIGGER_RECT.bottom + 4}px`);
		assert.equal(positioned.style.visibility, "");
	});

	/**
	 * With no room under the trigger the panel opens upwards, and its top has to
	 * come off the height it will take — placing it by the height it is merely
	 * allowed leaves it floating away from the button that opened it.
	 */
	it("opens upwards against the trigger when there is no room below", async () => {
		const low = { ...TRIGGER_RECT, top: 700, bottom: 732, y: 700 } as DOMRect;
		await mount({ rect: low });
		const positioned = panel()?.parentElement as HTMLElement;
		const top = Number.parseInt(positioned.style.top, 10);
		assert.ok(
			top < low.top,
			"the panel sits above the trigger, not below the fold",
		);
		assert.ok(
			low.top - top <= Number.parseInt(positioned.style.maxHeight, 10) + 4,
			"the panel's bottom edge stays with the trigger",
		);
	});

	it("moves focus into the panel and hands it back on dismissal", async () => {
		await mount();
		const field = dom.window.document.querySelector("[aria-label='Filter folders']");
		assert.equal(dom.window.document.activeElement, field);

		await act(async () => {
			dom.window.document.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
				}),
			);
		});
		assert.equal(
			dom.window.document.activeElement,
			dom.window.document.querySelector("[data-testid=trigger]"),
		);
	});

	it("dismisses on a press outside the panel and its trigger", async () => {
		let dismissed = 0;
		await mount({ onDismiss: () => (dismissed += 1) });
		await act(async () => {
			dom.window.document.body.dispatchEvent(
				new dom.window.MouseEvent("mousedown", { bubbles: true }),
			);
		});
		assert.equal(dismissed, 1);
		assert.equal(panel(), null);
	});

	it("keeps the panel open on a press inside it", async () => {
		let dismissed = 0;
		await mount({ onDismiss: () => (dismissed += 1) });
		await act(async () => {
			panel()?.dispatchEvent(
				new dom.window.MouseEvent("mousedown", { bubbles: true }),
			);
		});
		assert.equal(dismissed, 0);
		assert.ok(panel());
	});

	it("dismisses on Escape", async () => {
		await mount();
		await act(async () => {
			dom.window.document.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
				}),
			);
		});
		assert.equal(panel(), null);
	});
});
