/**
 * ThreadListInteraction (#149) — the cursor walks the rows that are on screen,
 * and delete asks before it trashes anything.
 *
 * The brief's sections cap themselves behind "Show N more" and collapse from
 * their headers, so what the consumer passed and what is rendered are different
 * lists. These cases mount rows directly and change them, which is the same
 * thing from the provider's point of view.
 *
 * The confirmation is worded from the folder the row is actually filed in
 * (#855): this list spans mailboxes and accounts, and deleting mail that is
 * already in Trash expunges it on the server rather than moving it.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { configOperationsGetConfigQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { ThreadRowData, Verb } from "@remit/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { JSDOM } from "jsdom";
import { act, createElement, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AuthProviderProvider, noneAuthProvider } from "@/auth/provider";
import { ErrorBannerProvider } from "@/components/ui/ErrorBannerProvider";
import { makeAccount, makeConfig } from "@/test-support/fixtures";
import type { MessageListCommands } from "./MessageList";
import {
	ThreadListInteraction,
	useThreadListSelection,
} from "./ThreadListInteraction";

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

const TRASH_MAILBOX_ID = "mbx-trash";

const row = (id: string, mailboxId = "mbx-inbox"): ThreadRowData => ({
	id,
	accountId: "acc-1",
	mailboxId,
	threadId: `t-${id}`,
	fromName: "Alice",
	fromEmail: "alice@example.com",
	subject: "Quarterly report",
	snippet: "",
	timeLabel: "9:42",
});

/**
 * A client that already holds the account's folder appointments, so the
 * confirmation's outcome is settled on the first render rather than arriving a
 * frame later.
 */
const seededClient = (trashMailboxId: string): QueryClient => {
	const client = new QueryClient();
	client.setQueryData(
		configOperationsGetConfigQueryKey(),
		makeConfig([
			makeAccount({
				accountId: "acc-1",
				folderAppointments: [{ role: "Trash", mailboxId: trashMailboxId }],
			}),
		]),
	);
	return client;
};

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
	rows?: readonly ThreadRowData[];
	client?: QueryClient;
	onDeleteMessages?: (ids: string[]) => void;
	onSelectionVerb?: (verb: Verb) => void;
}) {
	const onDeleteMessages = options.onDeleteMessages ?? (() => undefined);
	const onSelectionVerb = options.onSelectionVerb ?? (() => undefined);
	const rows = options.rows ?? options.initialIds.map((id) => row(id));
	const client = options.client ?? seededClient(TRASH_MAILBOX_ID);
	const authProvider = noneAuthProvider;
	const commandsRef = createRef<MessageListCommands | null>();
	let setIds: ((ids: string[]) => void) | undefined;
	const Harness = () => {
		const [ids, set] = useState(options.initialIds);
		setIds = set;
		return createElement(
			AuthProviderProvider,
			{ value: authProvider },
			createElement(
				QueryClientProvider,
				{ client },
				createElement(
					ErrorBannerProvider,
					null,
					createElement(
						ThreadListInteraction,
						{
							selectedMessageId: undefined,
							rows,
							onOpen: () => undefined,
							onDeleteMessages,
							onSelectionVerb,
							commandsRef,
						},
						...rowElements(ids),
					),
				),
			),
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
 * Issue #855. Flagged and the brief span mailboxes, so a row here can already
 * be in its account's Trash — where the same keypress is an IMAP expunge, not a
 * move. The confirmation used to promise "Move to Trash" over every one of
 * them, collecting an answer to a question the user was never asked.
 */
describe("ThreadListInteraction — the confirmation states the outcome it will produce", () => {
	const dialogText = (): string => dom.window.document.body.textContent ?? "";

	const askDelete = (list: ReturnType<typeof mountList>) => {
		act(() => list.commands().focusFirst());
		act(() => {
			list.commands().requestVerb("delete");
		});
	};

	it("asks a row already in Trash as a permanent delete", () => {
		const list = mountList({
			initialIds: ["m1", "m2"],
			rows: [row("m1", TRASH_MAILBOX_ID), row("m2")],
		});

		askDelete(list);

		const text = dialogText();
		assert.match(text, /Permanently delete 1 message\?/);
		assert.match(text, /cannot be restored/);
		assert.doesNotMatch(
			text,
			/Move 1 message to Trash\?/,
			"a move is not what this delete does",
		);
	});

	it("still offers the reversible move for a row filed outside Trash", () => {
		const list = mountList({
			initialIds: ["m1"],
			rows: [row("m1")],
		});

		askDelete(list);

		assert.match(dialogText(), /Move 1 message to Trash\?/);
		assert.match(dialogText(), /restore them from Trash later/);
	});

	it("refuses a row with no account the same way", () => {
		const deleted: string[][] = [];
		const list = mountList({
			initialIds: ["m1"],
			rows: [{ ...row("m1"), accountId: undefined }],
			onDeleteMessages: (ids) => deleted.push(ids),
		});

		act(() => list.commands().focusFirst());
		act(() => {
			assert.equal(list.commands().requestVerb("delete"), true);
		});

		assert.match(dialogText(), /Couldn.t delete this message/);
		assert.deepEqual(deleted, []);
	});

	it("refuses a row it cannot place instead of opening a dialog nobody can answer", () => {
		const deleted: string[][] = [];
		const list = mountList({
			initialIds: ["m1"],
			rows: [],
			onDeleteMessages: (ids) => deleted.push(ids),
		});

		act(() => list.commands().focusFirst());
		act(() => {
			assert.equal(
				list.commands().requestVerb("delete"),
				true,
				"the press is still claimed — handing it back runs the pane’s own unconfirmed delete",
			);
		});

		const text = dialogText();
		assert.match(text, /Couldn.t delete this message/);
		assert.match(text, /Nothing was deleted/);
		assert.ok(
			Array.from(
				dom.window.document.querySelectorAll<HTMLAnchorElement>("a"),
			).some((link) => link.textContent === "Reload the list"),
			"the refusal offers the control its own sentence names",
		);
		assert.doesNotMatch(
			text,
			/Checking where this account files deleted mail/,
			"no load is happening, so nothing may claim one is",
		);
		assert.equal(
			Array.from(
				dom.window.document.querySelectorAll<HTMLButtonElement>("button"),
			).some((button) => button.textContent === "Move to Trash"),
			false,
			"and no confirmation stands behind the refusal",
		);
		assert.deepEqual(deleted, [], "nothing is deleted by a refusal");
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
	const client = seededClient(TRASH_MAILBOX_ID);
	const authProvider = noneAuthProvider;
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
			AuthProviderProvider,
			{ value: authProvider },
			createElement(
				QueryClientProvider,
				{ client },
				createElement(
					ErrorBannerProvider,
					null,
					createElement(
						ThreadListInteraction,
						{
							selectedMessageId: undefined,
							rows: initialIds.map((id) => row(id)),
							onOpen: () => undefined,
							onDeleteMessages: () => undefined,
							onSelectionVerb: () => undefined,
							commandsRef,
						},
						...rowElements(ids),
						createElement(Probe, { key: "probe" }),
					),
				),
			),
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
