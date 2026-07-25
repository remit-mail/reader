/**
 * The create-and-move affordance: a search that names no existing folder offers
 * a create row only when `onCreateFolder` is wired; resolving it selects the new
 * folder. Mounted against jsdom since it turns on typed search state and an
 * async resolve. React is imported after the jsdom globals are installed so the
 * controlled-input value tracker binds to jsdom's prototypes.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import type {
	act as reactAct,
	createElement as reactCreateElement,
} from "react";
import type { Root, createRoot as reactCreateRoot } from "react-dom/client";
import type {
	MoveMailboxOption,
	MoveMailboxPicker as MoveMailboxPickerType,
} from "./move-mailbox-picker.js";

const mailboxes: MoveMailboxOption[] = [
	{ id: "archive", label: "Archive" },
	{ id: "trash", label: "Trash" },
];

let dom: JSDOM;
let container: HTMLElement;
let root: Root;
let act: typeof reactAct;
let createElement: typeof reactCreateElement;
let createRoot: typeof reactCreateRoot;
let MoveMailboxPicker: typeof MoveMailboxPickerType;

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
	({ createRoot } = await import("react-dom/client"));
	({ MoveMailboxPicker } = await import("./move-mailbox-picker.js"));
});

after(() => {
	dom.window.close();
});

beforeEach(() => {
	container = dom.window.document.getElementById(
		"root",
	) as unknown as HTMLElement;
	container.innerHTML = "";
	root = createRoot(container);
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
});

function typeSearch(value: string) {
	const input = container.querySelector(
		'input[aria-label="Filter folders"]',
	) as HTMLInputElement;
	const setter = Object.getOwnPropertyDescriptor(
		dom.window.HTMLInputElement.prototype,
		"value",
	)?.set;
	setter?.call(input, value);
	act(() => {
		input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
	});
}

function createRow(): HTMLButtonElement | null {
	return (
		Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.startsWith("Create "),
		) ?? null
	);
}

describe("MoveMailboxPicker create-and-move", () => {
	it("offers no create row without onCreateFolder, even when nothing matches", () => {
		act(() => {
			root.render(
				createElement(MoveMailboxPicker, {
					mailboxes,
					onSelect: () => {},
				}),
			);
		});
		typeSearch("Taxes");
		assert.equal(createRow(), null);
	});

	it("offers a create row when the query names no existing folder", () => {
		act(() => {
			root.render(
				createElement(MoveMailboxPicker, {
					mailboxes,
					onSelect: () => {},
					onCreateFolder: async () => ({ id: "new", label: "Taxes" }),
				}),
			);
		});
		typeSearch("Taxes");
		const row = createRow();
		assert.ok(row, "the create row is present");
		assert.match(row?.textContent ?? "", /Create "Taxes"/);
	});

	it("hides the create row when the query exactly names an existing folder", () => {
		act(() => {
			root.render(
				createElement(MoveMailboxPicker, {
					mailboxes,
					onSelect: () => {},
					onCreateFolder: async () => ({ id: "new", label: "Archive" }),
				}),
			);
		});
		typeSearch("archive");
		assert.equal(createRow(), null);
	});

	it("creates the folder and selects it in one step", async () => {
		const selected: string[] = [];
		act(() => {
			root.render(
				createElement(MoveMailboxPicker, {
					mailboxes,
					onSelect: (id: string) => selected.push(id),
					onCreateFolder: async (name: string) => ({
						id: "created-taxes",
						label: name,
					}),
				}),
			);
		});
		typeSearch("Taxes");
		await act(async () => {
			createRow()?.click();
		});
		assert.deepEqual(selected, ["created-taxes"]);
	});

	it("surfaces a validation rejection message inline without selecting anything", async () => {
		const selected: string[] = [];
		act(() => {
			root.render(
				createElement(MoveMailboxPicker, {
					mailboxes,
					onSelect: (id: string) => selected.push(id),
					onCreateFolder: async () => {
						throw new Error('A folder name can\'t contain "/".');
					},
				}),
			);
		});
		typeSearch("Work/Receipts");
		await act(async () => {
			createRow()?.click();
		});
		assert.deepEqual(selected, []);
		assert.match(
			container.querySelector('[role="alert"]')?.textContent ?? "",
			/can't contain/,
		);
	});

	it("falls back to the generic message for a non-Error rejection", async () => {
		act(() => {
			root.render(
				createElement(MoveMailboxPicker, {
					mailboxes,
					onSelect: () => {},
					onCreateFolder: async () => {
						throw "opaque";
					},
				}),
			);
		});
		typeSearch("Taxes");
		await act(async () => {
			createRow()?.click();
		});
		assert.match(
			container.querySelector('[role="alert"]')?.textContent ?? "",
			/Couldn't create that folder/,
		);
	});
});
