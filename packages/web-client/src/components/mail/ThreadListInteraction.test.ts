/**
 * ThreadListInteraction (#149) — the cursor walks the rows that are on screen,
 * and delete asks before it trashes anything.
 *
 * The brief's sections cap themselves behind "Show N more" and collapse from
 * their headers, so what the consumer passed and what is rendered are different
 * lists. These cases mount rows directly and change them, which is the same
 * thing from the provider's point of view.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import {
	BriefSections,
	ComfortableRow,
	type ThreadSection,
	useTriageKeyboard,
	type Verb,
} from "@remit/ui";
import type { JSDOM } from "jsdom";
import React, { act, createElement, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MessageListCommands } from "./MessageList";
import {
	ThreadListInteraction,
	useThreadListSelection,
} from "./ThreadListInteraction";

// The test loader transpiles the kit's `.tsx` with the classic JSX runtime,
// which reads a global `React` (see ReadingPaneEmpty.render.test.ts).
(globalThis as { React?: typeof React }).React = React;

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
	globalThis.MutationObserver = dom.window.MutationObserver;
	Object.defineProperty(globalThis, "navigator", {
		value: dom.window.navigator,
		configurable: true,
	});
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

after(() => dom.window.close());

beforeEach(() => {
	container = dom.window.document.getElementById(
		"root",
	) as unknown as HTMLElement;
	container.innerHTML = "";
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
});

const rowElements = (ids: string[]) =>
	ids.map((id) =>
		createElement("button", { key: id, type: "button", "data-message-id": id }),
	);

/**
 * Mount the provider over a set of rows, with a hook to change which rows are
 * rendered afterwards — what "Show N more" and a collapsing section header do.
 */
function mountList(options: {
	initialIds: string[];
	onDeleteMessages?: (ids: string[]) => void;
	onSelectionVerb?: (verb: Verb) => void;
}) {
	const onDeleteMessages = options.onDeleteMessages ?? (() => undefined);
	const onSelectionVerb = options.onSelectionVerb ?? (() => undefined);
	const commandsRef = createRef<MessageListCommands | null>();
	let setIds: ((ids: string[]) => void) | undefined;
	const Harness = () => {
		const [ids, set] = useState(options.initialIds);
		setIds = set;
		return createElement(
			ThreadListInteraction,
			{
				selectedMessageId: undefined,
				onOpen: () => undefined,
				onDeleteMessages,
				onSelectionVerb,
				commandsRef,
			},
			...rowElements(ids),
		);
	};
	act(() => root.render(createElement(Harness)));
	return {
		commands: () => {
			const commands = commandsRef.current;
			if (!commands) throw new Error("commands not published");
			return commands;
		},
		// The provider reads the rendered rows through a MutationObserver, whose
		// callback lands on the microtask queue — an async act flushes both.
		render: async (ids: string[]) => {
			await act(async () => {
				setIds?.(ids);
			});
		},
		focusedId: () =>
			(dom.window.document.activeElement as HTMLElement | null)?.dataset
				.messageId,
	};
}

describe("ThreadListInteraction — the cursor follows the rendered rows", () => {
	it("walks only the rows in the DOM", () => {
		const list = mountList({ initialIds: ["m1", "m2", "m3"] });

		act(() => list.commands().focusFirst());
		assert.equal(list.focusedId(), "m1");

		act(() => list.commands().focusLast());
		assert.equal(list.focusedId(), "m3");
	});

	it("stops at the last rendered row, not the last row in the data", () => {
		// The capped case: three rows are on screen, more exist behind the
		// expander. The cursor must not step past what is rendered.
		const list = mountList({ initialIds: ["m1", "m2", "m3"] });

		act(() => list.commands().focusLast());
		act(() => list.commands().focusNext());
		assert.equal(list.focusedId(), "m3");
	});

	it("picks up rows revealed by the expander", async () => {
		const list = mountList({ initialIds: ["m1", "m2", "m3"] });
		act(() => list.commands().focusLast());
		assert.equal(list.focusedId(), "m3");

		await list.render(["m1", "m2", "m3", "m4", "m5"]);

		act(() => list.commands().focusLast());
		assert.equal(list.focusedId(), "m5");
	});

	it("withdraws its commands when every row leaves", async () => {
		const list = mountList({ initialIds: ["m1"] });
		assert.ok(list.commands());
		await list.render([]);
		assert.throws(() => list.commands(), /commands not published/);
	});
});

/**
 * The provider runs no verb over a selection. Every one of them is handed out
 * to be opened on the wizard, which is the only place a bulk action is named
 * before it reaches the mail server (#477 1.4, #508). A verb aimed at the bare
 * cursor is one message rather than a bulk action, and only Delete is this
 * list's — it keeps its confirmation.
 */
describe("ThreadListInteraction — a verb over a selection goes to the wizard", () => {
	const selectRow = (
		list: ReturnType<typeof mountList>,
		toggleFirst = true,
	) => {
		act(() => list.commands().focusFirst());
		if (toggleFirst) act(() => list.commands().toggleSelect());
	};

	for (const verb of [
		"delete",
		"move",
		"junk",
		"markRead",
		"organize",
	] as const) {
		it(`hands ${verb} over rather than running it`, () => {
			const handed: Verb[] = [];
			const deleted: string[][] = [];
			const list = mountList({
				initialIds: ["m1", "m2"],
				onDeleteMessages: (ids) => deleted.push(ids),
				onSelectionVerb: (v) => handed.push(v),
			});

			selectRow(list);
			act(() => {
				assert.equal(list.commands().requestVerb(verb), true);
			});

			assert.deepEqual(handed, [verb]);
			assert.deepEqual(deleted, [], "nothing runs from here");
			assert.equal(
				Array.from(
					dom.window.document.querySelectorAll<HTMLButtonElement>("button"),
				).some((b) => b.textContent === "Move to Trash"),
				false,
				"no second confirmation stands in for the review screen",
			);
		});
	}

	it("leaves a verb aimed at the bare cursor to the pane, except delete", () => {
		const handed: Verb[] = [];
		const list = mountList({
			initialIds: ["m1", "m2"],
			onSelectionVerb: (v) => handed.push(v),
		});

		act(() => list.commands().focusFirst());
		act(() => {
			assert.equal(list.commands().requestVerb("markRead"), false);
			assert.equal(list.commands().requestVerb("junk"), false);
		});
		assert.deepEqual(handed, [], "one row is not a selection");
	});
});

describe("ThreadListInteraction — delete confirms first", () => {
	const confirmButton = () =>
		Array.from(
			dom.window.document.querySelectorAll<HTMLButtonElement>("button"),
		).find((b) => b.textContent === "Move to Trash");

	it("asks before it trashes anything", () => {
		const deleted: string[][] = [];
		const list = mountList({
			initialIds: ["m1", "m2"],
			onDeleteMessages: (ids) => deleted.push(ids),
		});

		act(() => list.commands().focusFirst());
		act(() => {
			assert.equal(list.commands().requestVerb("delete"), true);
		});
		assert.deepEqual(deleted, [], "nothing is deleted before confirming");
		assert.ok(confirmButton(), "the confirmation is on screen");

		act(() => confirmButton()?.click());
		assert.deepEqual(deleted, [["m1"]]);
	});

	it("claims a second Delete rather than deleting behind the dialog", () => {
		const deleted: string[][] = [];
		const list = mountList({
			initialIds: ["m1", "m2"],
			onDeleteMessages: (ids) => deleted.push(ids),
		});

		act(() => list.commands().focusFirst());
		act(() => {
			list.commands().requestVerb("delete");
		});
		act(() => {
			assert.equal(
				list.commands().requestVerb("delete"),
				true,
				"the second press belongs to the dialog",
			);
		});
		assert.deepEqual(deleted, []);
	});

	it("declines the keypress when there is nothing to delete", () => {
		const list = mountList({
			initialIds: ["m1"],
			onDeleteMessages: () => undefined,
		});
		act(() => {
			assert.equal(list.commands().requestVerb("delete"), false);
		});
	});
});

/**
 * A background refresh drops the ids that left and keeps every survivor — the
 * same intersect-on-refresh guarantee `useSelection.test.ts` locks for the pure
 * helper (#111), here through the live provider whose effect runs it whenever
 * the rendered rows change (a chip filter, a collapsed section, mail deleted
 * elsewhere).
 */
function mountSelectableList(initialIds: string[]) {
	const commandsRef = createRef<MessageListCommands | null>();
	let setIds: ((ids: string[]) => void) | undefined;
	let selected: string[] = [];
	const Probe = () => {
		const { selectedIds } = useThreadListSelection();
		selected = Array.from(selectedIds).sort();
		return null;
	};
	const Harness = () => {
		const [ids, set] = useState(initialIds);
		setIds = set;
		return createElement(
			ThreadListInteraction,
			{
				selectedMessageId: undefined,
				onOpen: () => undefined,
				onDeleteMessages: () => undefined,
				onSelectionVerb: () => undefined,
				commandsRef,
			},
			...rowElements(ids),
			createElement(Probe, { key: "probe" }),
		);
	};
	act(() => root.render(createElement(Harness)));
	return {
		commands: () => {
			const commands = commandsRef.current;
			if (!commands) throw new Error("commands not published");
			return commands;
		},
		render: async (ids: string[]) => {
			await act(async () => {
				setIds?.(ids);
			});
		},
		selected: () => selected,
	};
}

describe("ThreadListInteraction — selection survives a background refresh (#111)", () => {
	it("keeps every survivor when a refresh drops one selected row", async () => {
		const list = mountSelectableList(["m1", "m2", "m3"]);

		// jsdom has no matchMedia, so the provider runs in mobile multi-select
		// mode: focusFirst seeds the cursor, x toggles it in, and focusLast then
		// toggles the row it lands on straight into the selection.
		act(() => list.commands().focusFirst());
		act(() => list.commands().toggleSelect());
		act(() => list.commands().focusLast());
		assert.deepEqual(list.selected(), ["m1", "m3"]);

		// m3 leaves the rendered set (deleted elsewhere / filtered out); m2 is
		// present but was never selected.
		await list.render(["m1", "m2"]);

		assert.deepEqual(
			list.selected(),
			["m1"],
			"the survivor stays selected, the departed id is dropped, and nothing new is added",
		);
	});

	it("empties the selection only when every selected row leaves", async () => {
		const list = mountSelectableList(["m1", "m2"]);
		act(() => list.commands().focusFirst());
		act(() => list.commands().toggleSelect());
		assert.deepEqual(list.selected(), ["m1"]);

		await list.render(["m9"]);

		assert.deepEqual(list.selected(), []);
	});
});

/**
 * The brief's rows sit under this provider and inside the kit's own list body,
 * which brings a roving-focus group of its own. That group reads only
 * `event.key`, so left standing it takes Shift+↑/↓ as plain arrows and stops
 * them before the window layer can extend a range with them (#584).
 */
describe("ThreadListInteraction — the arrows reach the layer from the brief's rows", () => {
	const briefSections: ThreadSection[] = [
		{
			id: "personal",
			label: "Personal",
			threads: ["t1", "t2", "t3"].map((id) => ({
				id,
				accountId: "a1",
				fromName: "Priya Nair",
				fromEmail: "priya@example.com",
				subject: `Message ${id}`,
				snippet: "Can we move it to 2pm?",
				timeLabel: "8:15",
				category: "personal" as const,
			})),
		},
	];

	function mountBrief() {
		const commandsRef = createRef<MessageListCommands | null>();
		let selected: string[] = [];

		const Probe = () => {
			selected = Array.from(useThreadListSelection().selectedIds);
			return null;
		};

		const WindowKeys = () => {
			useTriageKeyboard({
				handlers: {
					focusNext: () => commandsRef.current?.focusNext(),
					focusPrevious: () => commandsRef.current?.focusPrevious(),
					extendSelectDown: () => commandsRef.current?.extendSelectDown(),
					extendSelectUp: () => commandsRef.current?.extendSelectUp(),
				},
			});
			return null;
		};

		const Harness = () =>
			createElement(
				ThreadListInteraction,
				{
					selectedMessageId: undefined,
					onOpen: () => undefined,
					onDeleteMessages: () => undefined,
					onSelectionVerb: () => undefined,
					commandsRef,
				},
				createElement(Probe),
				createElement(WindowKeys),
				createElement(BriefSections, {
					key: "brief",
					sections: briefSections,
					Row: ComfortableRow,
				}),
			);

		act(() => root.render(createElement(Harness)));

		const rowFor = (id: string): HTMLElement => {
			const row = container.querySelector<HTMLElement>(
				`[data-message-id="${id}"]`,
			);
			assert.ok(row, `no row for ${id}`);
			return row;
		};

		return {
			rowFor,
			selected: () => selected.slice().sort(),
			focusedId: () =>
				(dom.window.document.activeElement as HTMLElement | null)?.dataset
					.messageId,
			press: (key: string, init: KeyboardEventInit = {}, from = "t1") => {
				act(() => {
					rowFor(from).dispatchEvent(
						new dom.window.KeyboardEvent("keydown", {
							key,
							bubbles: true,
							cancelable: true,
							...init,
						}),
					);
				});
			},
		};
	}

	it("extends the selection with Shift+ArrowDown", () => {
		const brief = mountBrief();
		brief.press("ArrowDown");
		assert.equal(brief.focusedId(), "t1");

		brief.press("ArrowDown", { shiftKey: true }, "t1");
		assert.deepEqual(brief.selected(), ["t2"]);

		brief.press("ArrowDown", { shiftKey: true }, "t2");
		assert.deepEqual(brief.selected(), ["t2", "t3"]);
	});

	it("moves the cursor with a plain arrow rather than a focus ring of its own", () => {
		const brief = mountBrief();
		brief.press("ArrowDown");
		brief.press("ArrowDown", {}, "t1");
		assert.equal(
			brief.focusedId(),
			"t2",
			"one cursor: the layer's, with real focus on the row it names",
		);
	});
});
