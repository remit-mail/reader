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
import type { JSDOM } from "jsdom";
import { act, createElement, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MessageListCommands } from "./MessageList";
import { ThreadListInteraction } from "./ThreadListInteraction";

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
}) {
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
				onDeleteMessages: options.onDeleteMessages,
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
			assert.equal(list.commands().requestDelete(), true);
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
			list.commands().requestDelete();
		});
		act(() => {
			assert.equal(
				list.commands().requestDelete(),
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
			assert.equal(list.commands().requestDelete(), false);
		});
	});
});
