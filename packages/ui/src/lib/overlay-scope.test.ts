/**
 * The overlay stack, from the outside: what a window-level listener under an
 * open overlay is allowed to see (#958), and what a triage layer under one is
 * allowed to run (#959).
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	type OverlayAnswers,
	resolveAgainstOverlays,
	useOverlayScope,
} from "./overlay-scope.js";
import { useTriageKeyboard } from "./use-triage-keyboard.js";

let root: Root;
let seen: string[];
let listener: (event: KeyboardEvent) => void;

beforeEach(() => {
	const container = document.getElementById("root") as unknown as HTMLElement;
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

const press = (key: string) => {
	act(() => {
		document.body.dispatchEvent(
			new window.KeyboardEvent("keydown", { key, bubbles: true }),
		);
	});
};

function Scope({
	id,
	open,
	answers,
	children,
}: {
	id: string;
	open: boolean;
	answers?: OverlayAnswers;
	children?: ReactNode;
}) {
	useOverlayScope({ id, open, answers });
	return children ?? null;
}

const render = (element: ReactNode) => {
	act(() => root.render(element));
};

describe("an overlay on the stack", () => {
	it("answers Escape itself and leaves nothing for the window to see", () => {
		const dismissed: string[] = [];
		render(
			createElement(Scope, {
				id: "sheet",
				open: true,
				answers: { back: () => dismissed.push("sheet") },
			}),
		);

		press("Escape");

		assert.deepEqual(dismissed, ["sheet"]);
		assert.deepEqual(
			seen,
			[],
			"the layer behind the overlay saw the same press",
		);
	});

	it("hands the key back once it closes", () => {
		render(createElement(Scope, { id: "sheet", open: true, answers: {} }));
		render(createElement(Scope, { id: "sheet", open: false, answers: {} }));

		press("Escape");

		assert.deepEqual(seen, ["Escape"]);
	});

	it("dismisses the last overlay to open, not the one under it", () => {
		const dismissed: string[] = [];
		const stack = (confirming: boolean) =>
			createElement(Scope, {
				id: "drawer",
				open: true,
				answers: { back: () => dismissed.push("drawer") },
				// biome-ignore lint/correctness/noChildrenProp: no JSX in a `.ts` test
				children: createElement(Scope, {
					id: "confirm",
					open: confirming,
					answers: { back: () => dismissed.push("confirm") },
				}),
			});

		render(stack(false));
		render(stack(true));

		press("Escape");

		assert.deepEqual(
			dismissed,
			["confirm"],
			"the drawer under the confirmation closed on the same press",
		);
	});

	it("yields Escape to a control inside it that owns one", () => {
		const dismissed: string[] = [];
		render(
			createElement(Scope, {
				id: "sheet",
				open: true,
				answers: { back: () => dismissed.push("sheet") },
				// biome-ignore lint/correctness/noChildrenProp: no JSX in a `.ts` test
				children: createElement("input", {
					"data-escape-owner": "",
					id: "suggesting",
				}),
			}),
		);
		(document.getElementById("suggesting") as HTMLInputElement).focus();

		press("Escape");

		assert.deepEqual(dismissed, [], "the overlay took Escape from the field");
	});
});

describe("what the surfaces under an overlay may act on", () => {
	it("contains an action the overlay does not serve", () => {
		render(createElement(Scope, { id: "sheet", open: true, answers: {} }));

		assert.equal(resolveAgainstOverlays("compose")?.outcome, "contained");
	});

	it("resolves to nothing at all with no overlay up", () => {
		assert.equal(resolveAgainstOverlays("compose"), null);
	});

	it("leaves a triage layer's compose inert under a modal (#959)", () => {
		const composed: string[] = [];
		function Layer({ modal }: { modal: boolean }) {
			useTriageKeyboard({ handlers: { compose: () => composed.push("c") } });
			return createElement(Scope, {
				id: "confirm",
				open: modal,
				answers: { back: () => undefined },
			});
		}

		render(createElement(Layer, { modal: true }));
		press("c");
		assert.deepEqual(composed, [], "c opened compose from under the modal");

		render(createElement(Layer, { modal: false }));
		press("c");
		assert.deepEqual(composed, ["c"], "c stayed dead after the modal closed");
	});
});
