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
	overlayStack,
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

const press = (key: string, from: EventTarget = document.body) => {
	act(() => {
		from.dispatchEvent(
			new window.KeyboardEvent("keydown", { key, bubbles: true }),
		);
	});
};

const field = (id: string): HTMLInputElement =>
	document.getElementById(id) as HTMLInputElement;

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

	// Both open in one render, which is the case mount order gets wrong: React
	// runs the inner overlay's effects first, so registration order would put the
	// drawer on top of the confirmation it contains.
	it("is answered by the innermost overlay, however the two came to be open", () => {
		const dismissed: string[] = [];
		const stack = () =>
			createElement(Scope, {
				id: "drawer",
				open: true,
				answers: { back: () => dismissed.push("drawer") },
				// biome-ignore lint/correctness/noChildrenProp: no JSX in a `.ts` test
				children: createElement(Scope, {
					id: "confirm",
					open: true,
					answers: { back: () => dismissed.push("confirm") },
				}),
			});

		render(stack());
		press("Escape");
		assert.deepEqual(
			dismissed,
			["confirm"],
			"the drawer under the confirmation answered for it",
		);

		assert.deepEqual(
			overlayStack().map((frame) => frame.id),
			["drawer", "confirm"],
			"the stack is not ordered outside-in",
		);
	});

	it("says what it answers without leaving the stack to say it", () => {
		const rung: string[] = [];
		const scope = (serving: boolean) =>
			createElement(Scope, {
				id: "drawer",
				open: true,
				answers: serving
					? {
							back: () => rung.push("back"),
							toggleIntelligence: () => rung.push("toggleIntelligence"),
						}
					: { back: () => rung.push("back") },
				// biome-ignore lint/correctness/noChildrenProp: no JSX in a `.ts` test
				children: createElement(Scope, {
					id: "confirm",
					open: true,
					answers: { back: () => rung.push("confirm") },
				}),
			});

		render(scope(false));
		render(scope(true));

		press("Escape");

		assert.deepEqual(
			rung,
			["confirm"],
			"changing what the drawer answers moved it above the confirmation",
		);
	});

	it("keeps serving the key that opened it, and nothing else", () => {
		const rung: string[] = [];
		render(
			createElement(Scope, {
				id: "drawer",
				open: true,
				answers: {
					back: () => rung.push("back"),
					toggleIntelligence: () => rung.push("toggleIntelligence"),
				},
			}),
		);

		press("i");
		press("j");

		assert.deepEqual(rung, ["toggleIntelligence"]);
		// Only what the drawer answered is swallowed. A key it does not serve is
		// left to travel; what stops it is the triage layer declining to run it.
		assert.deepEqual(seen, ["j"], "the drawer ate a key it never answered");
	});

	it("is not answered by a key typed into a field inside it", () => {
		const rung: string[] = [];
		render(
			createElement(Scope, {
				id: "drawer",
				open: true,
				answers: {
					back: () => rung.push("back"),
					toggleIntelligence: () => rung.push("toggleIntelligence"),
				},
				// biome-ignore lint/correctness/noChildrenProp: no JSX in a `.ts` test
				children: createElement("input", { id: "typing" }),
			}),
		);

		press("i", field("typing"));

		assert.deepEqual(
			rung,
			[],
			"a letter typed into the field closed the drawer",
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

	it("leaves c and i typed into a field under an overlay inert (#959)", () => {
		const ran: string[] = [];
		function Layer() {
			useTriageKeyboard({
				handlers: {
					compose: () => ran.push("compose"),
					toggleIntelligence: () => ran.push("toggleIntelligence"),
				},
			});
			return createElement(Scope, {
				id: "sheet",
				open: true,
				answers: { back: () => undefined },
				// biome-ignore lint/correctness/noChildrenProp: no JSX in a `.ts` test
				children: createElement("input", { id: "typing" }),
			});
		}

		render(createElement(Layer));

		press("c", field("typing"));
		press("i", field("typing"));

		assert.deepEqual(
			ran,
			[],
			"typing under an overlay reached the layer below",
		);
	});

	it("drops a g prefix rather than arming one behind the overlay", () => {
		const went: string[] = [];
		function Layer({ modal }: { modal: boolean }) {
			useTriageKeyboard({ handlers: { goBrief: () => went.push("goBrief") } });
			return createElement(Scope, {
				id: "sheet",
				open: modal,
				answers: { back: () => undefined },
			});
		}

		// `g` over the modal must not leave a prefix behind for the `b` that
		// follows it, which lands after the overlay has gone.
		render(createElement(Layer, { modal: true }));
		press("g");
		render(createElement(Layer, { modal: false }));
		press("b");
		assert.deepEqual(went, [], "a sequence completed across the modal");

		press("g");
		press("b");
		assert.deepEqual(went, ["goBrief"], "g stayed dead after the modal closed");
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
