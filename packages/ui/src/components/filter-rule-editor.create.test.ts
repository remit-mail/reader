/**
 * The move-to "New folder…" affordance: the option shows only when
 * `onCreateFolder` is wired; choosing it reveals a name field, and a resolved
 * create picks the new folder as the destination. Mounted against jsdom for the
 * select interaction, the inline field state, and the async resolve. React is
 * imported after the jsdom globals are installed so the controlled value tracker
 * binds to jsdom's prototypes.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import type {
	act as reactAct,
	createElement as reactCreateElement,
} from "react";
import type { Root, createRoot as reactCreateRoot } from "react-dom/client";
import type { FilterRule, FolderOption, PreviewCount } from "./filter-rule.js";
import type { FilterRuleEditor as FilterRuleEditorType } from "./filter-rule-editor.js";

const folders: FolderOption[] = [
	{ id: "mbx-inbox", label: "Inbox" },
	{ id: "mbx-archive", label: "Archive" },
];

const rule: FilterRule = {
	clauses: [{ id: "c1", field: "From", value: "a@example.com" }],
	matchOperator: "all",
	scope: "once",
};

const preview: PreviewCount = { status: "ready", count: 3 };

let dom: JSDOM;
let container: HTMLElement;
let root: Root;
let act: typeof reactAct;
let createElement: typeof reactCreateElement;
let createRoot: typeof reactCreateRoot;
let FilterRuleEditor: typeof FilterRuleEditorType;

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
	({ FilterRuleEditor } = await import("./filter-rule-editor.js"));
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

function destinationSelect(): HTMLSelectElement {
	return container.querySelector(
		'select[aria-label="Destination folder"]',
	) as HTMLSelectElement;
}

function createOption(): HTMLOptionElement | undefined {
	return Array.from(destinationSelect().querySelectorAll("option")).find(
		(option) => option.textContent?.includes("New folder"),
	);
}

function chooseCreateOption() {
	const select = destinationSelect();
	const value = createOption()?.value ?? "";
	const setter = Object.getOwnPropertyDescriptor(
		dom.window.HTMLSelectElement.prototype,
		"value",
	)?.set;
	setter?.call(select, value);
	act(() => {
		select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
	});
}

function setInput(el: HTMLInputElement, value: string) {
	const setter = Object.getOwnPropertyDescriptor(
		dom.window.HTMLInputElement.prototype,
		"value",
	)?.set;
	setter?.call(el, value);
	act(() => {
		el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
	});
}

function button(text: string): HTMLButtonElement | undefined {
	return Array.from(container.querySelectorAll("button")).find(
		(candidate) => candidate.textContent?.trim() === text,
	);
}

function mount(overrides: {
	onCreateFolder?: (name: string) => Promise<FolderOption>;
	onChangeMove?: (id: string) => void;
}) {
	act(() => {
		root.render(
			createElement(FilterRuleEditor, {
				rule,
				folders,
				preview,
				onCommit: () => {},
				onCancel: () => {},
				...overrides,
			}),
		);
	});
}

describe("FilterRuleEditor new-folder option", () => {
	it("does not offer the create option without onCreateFolder", () => {
		mount({});
		assert.equal(createOption(), undefined);
	});

	it("offers the create option when onCreateFolder is wired", () => {
		mount({ onCreateFolder: async () => ({ id: "x", label: "x" }) });
		assert.ok(createOption(), "the ＋ New folder… option is present");
	});

	it("reveals the name field only after the option is chosen", () => {
		mount({ onCreateFolder: async () => ({ id: "x", label: "x" }) });
		assert.equal(
			container.querySelector('input[aria-label="New folder name"]'),
			null,
		);
		chooseCreateOption();
		assert.ok(
			container.querySelector('input[aria-label="New folder name"]'),
			"the name field appears",
		);
	});

	it("creates the folder and selects it as the destination", async () => {
		const moved: string[] = [];
		mount({
			onChangeMove: (id) => moved.push(id),
			onCreateFolder: async (name) => ({ id: "mbx-created", label: name }),
		});
		chooseCreateOption();
		const nameInput = container.querySelector(
			'input[aria-label="New folder name"]',
		) as HTMLInputElement;
		setInput(nameInput, "Receipts");
		await act(async () => {
			button("Create folder")?.click();
		});
		assert.deepEqual(moved, ["mbx-created"]);
	});

	it("keeps the name field open and surfaces the rejection message when create fails", async () => {
		const moved: string[] = [];
		mount({
			onChangeMove: (id) => moved.push(id),
			onCreateFolder: async () => {
				throw new Error("A folder with that name already exists.");
			},
		});
		chooseCreateOption();
		const nameInput = container.querySelector(
			'input[aria-label="New folder name"]',
		) as HTMLInputElement;
		setInput(nameInput, "Archive");
		await act(async () => {
			button("Create folder")?.click();
		});
		assert.deepEqual(moved, []);
		assert.ok(
			container.querySelector('input[aria-label="New folder name"]'),
			"the name field stays open",
		);
		assert.match(
			container.querySelector('[role="alert"]')?.textContent ?? "",
			/already exists/,
		);
	});

	it("falls back to the generic message for a non-Error rejection", async () => {
		mount({
			onCreateFolder: async () => {
				throw "opaque";
			},
		});
		chooseCreateOption();
		const nameInput = container.querySelector(
			'input[aria-label="New folder name"]',
		) as HTMLInputElement;
		setInput(nameInput, "Receipts");
		await act(async () => {
			button("Create folder")?.click();
		});
		assert.match(
			container.querySelector('[role="alert"]')?.textContent ?? "",
			/Couldn't create that folder/,
		);
	});

	it("cancels the create field and leaves the destination unchanged", () => {
		const moved: string[] = [];
		mount({
			onChangeMove: (id) => moved.push(id),
			onCreateFolder: async (name) => ({ id: "mbx-created", label: name }),
		});
		chooseCreateOption();
		act(() => {
			button("Cancel")?.click();
		});
		assert.equal(
			container.querySelector('input[aria-label="New folder name"]'),
			null,
		);
		assert.deepEqual(moved, []);
	});
});
