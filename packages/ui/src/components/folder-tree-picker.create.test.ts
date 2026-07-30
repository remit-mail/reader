/**
 * The inline create form: where it opens, what it says the parent is, and how it
 * behaves while the mail server is confirming the folder. Mounted against jsdom
 * for the anchoring, the field state and the async resolve. React is imported
 * after the jsdom globals are installed so the controlled value tracker binds to
 * jsdom's prototypes.
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
	FolderTreeNode,
	FolderTreePicker as FolderTreePickerType,
} from "./folder-tree-picker.js";

const folders: FolderTreeNode[] = [
	{ id: "inbox", label: "Inbox", path: "INBOX", isCurrent: true },
	{ id: "travel", label: "Travel", path: "Travel" },
	{ id: "hotels", label: "Hotels", path: "Travel/Hotels" },
	{ id: "archive", label: "Archive", path: "Archive" },
];

let dom: JSDOM;
let container: HTMLElement;
let root: Root;
let act: typeof reactAct;
let createElement: typeof reactCreateElement;
let createRoot: typeof reactCreateRoot;
let FolderTreePicker: typeof FolderTreePickerType;

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
	({ FolderTreePicker } = await import("./folder-tree-picker.js"));
});

after(() => {
	dom.window.close();
});

beforeEach(() => {
	container = dom.window.document.createElement("div");
	dom.window.document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => {
		root.unmount();
	});
	container.remove();
});

const mount = async (
	props: Partial<Parameters<typeof FolderTreePickerType>[0]> = {},
) => {
	await act(async () => {
		root.render(
			createElement(FolderTreePicker, {
				folders,
				onSelect: () => {},
				...props,
			}),
		);
	});
};

const click = async (element: Element | null | undefined) => {
	assert.ok(element, "control not rendered");
	await act(async () => {
		(element as HTMLElement).click();
	});
};

const byAriaLabel = (label: string): HTMLElement | null =>
	container.querySelector(`[aria-label="${label}"]`);

const byText = (label: string): HTMLButtonElement | undefined =>
	Array.from(container.querySelectorAll("button")).find(
		(button) => button.textContent?.trim() === label,
	);

const nameField = (): HTMLInputElement | null =>
	container.querySelector('input:not([type="search"])');

const typeName = async (value: string) => {
	const input = nameField();
	assert.ok(input, "name field not rendered");
	const setter = Object.getOwnPropertyDescriptor(
		dom.window.HTMLInputElement.prototype,
		"value",
	)?.set;
	await act(async () => {
		setter?.call(input, value);
		input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
	});
};

const rowOf = (label: string): Element | null =>
	byAriaLabel(`Move to ${label}`)?.closest('[role="none"]') ?? null;

const created = (name: string, parentPath: string): FolderTreeNode => ({
	id: "made",
	label: name,
	path: parentPath ? `${parentPath}/${name}` : name,
});

describe("create form anchoring", () => {
	it("opens under the row whose affordance was pressed", async () => {
		await mount({ onCreateFolder: (n, p) => Promise.resolve(created(n, p)) });
		await click(byAriaLabel("New folder inside Travel"));
		assert.ok(rowOf("Travel")?.querySelector("input"));
		assert.equal(rowOf("Hotels")?.querySelector("input"), null);
	});

	it("states the parent as fixed text rather than a second choice", async () => {
		await mount({ onCreateFolder: (n, p) => Promise.resolve(created(n, p)) });
		await click(byAriaLabel("New folder inside Travel"));
		assert.match(rowOf("Travel")?.textContent ?? "", /Inside\s*Travel/);
		assert.equal(container.querySelector("select"), null);
	});

	it("moves the form when another row opens it", async () => {
		await mount({ onCreateFolder: (n, p) => Promise.resolve(created(n, p)) });
		await click(byAriaLabel("New folder inside Travel"));
		await click(byAriaLabel("New folder inside Hotels"));
		assert.equal(rowOf("Travel")?.querySelector("input"), null);
		assert.ok(rowOf("Hotels")?.querySelector("input"));
	});

	it("creates at top level from the row above the tree", async () => {
		await mount({ onCreateFolder: (n, p) => Promise.resolve(created(n, p)) });
		await click(byText("New folder"));
		assert.equal(rowOf("Travel")?.querySelector("input"), null);
		assert.ok(nameField());
		assert.match(container.textContent ?? "", /Inside\s*Top level/);
	});

	it("offers a subfolder inside the current folder", async () => {
		await mount({ onCreateFolder: (n, p) => Promise.resolve(created(n, p)) });
		assert.ok(byAriaLabel("New folder inside Inbox"));
	});

	it("closes on Cancel", async () => {
		await mount({ onCreateFolder: (n, p) => Promise.resolve(created(n, p)) });
		await click(byAriaLabel("New folder inside Travel"));
		await click(byText("Cancel"));
		assert.equal(nameField(), null);
	});
});

describe("create wait", () => {
	it("passes the row's path as the parent and selects what comes back", async () => {
		const calls: Array<[string, string]> = [];
		const selected: string[] = [];
		await mount({
			onSelect: (id) => selected.push(id),
			onCreateFolder: (name, parentPath) => {
				calls.push([name, parentPath]);
				return Promise.resolve(created(name, parentPath));
			},
		});
		await click(byAriaLabel("New folder inside Travel"));
		await typeName("Hotels 2");
		await click(byText("Create folder"));
		assert.deepEqual(calls, [["Hotels 2", "Travel"]]);
		assert.deepEqual(selected, ["made"]);
		assert.equal(nameField(), null);
	});

	it("shows the wait and refuses a second submit while it runs", async () => {
		let attempts = 0;
		await mount({
			onCreateFolder: () => {
				attempts += 1;
				return new Promise<FolderTreeNode>(() => undefined);
			},
		});
		await click(byAriaLabel("New folder inside Travel"));
		await typeName("Hotels 2");
		await click(byText("Create folder"));
		const pending = byText("Creating folder…");
		assert.ok(pending);
		assert.equal(pending.disabled, true);
		await click(pending);
		assert.equal(attempts, 1);
	});

	it("states a failure where it happened and keeps the form open", async () => {
		await mount({
			onCreateFolder: () =>
				Promise.reject(new Error("The mail server refused that name.")),
		});
		await click(byAriaLabel("New folder inside Travel"));
		await typeName("Hotels 2");
		await click(byText("Create folder"));
		const alert = container.querySelector('[role="alert"]');
		assert.equal(alert?.textContent, "The mail server refused that name.");
		assert.ok(rowOf("Travel")?.querySelector("input"));
	});

	it("says what is missing instead of going dead on an empty name", async () => {
		let attempts = 0;
		await mount({
			onCreateFolder: (n, p) => {
				attempts += 1;
				return Promise.resolve(created(n, p));
			},
		});
		await click(byAriaLabel("New folder inside Travel"));
		await click(byText("Create folder"));
		assert.equal(attempts, 0);
		assert.match(
			container.querySelector('[role="alert"]')?.textContent ?? "",
			/Give the folder a name/,
		);
	});

	it("aborts the wait on unmount so a late confirmation selects nothing", async () => {
		let signal: AbortSignal | undefined;
		const selected: string[] = [];
		await mount({
			onSelect: (id) => selected.push(id),
			onCreateFolder: (_name, _parentPath, abortSignal) => {
				signal = abortSignal;
				return new Promise<FolderTreeNode>((_resolve, reject) => {
					abortSignal?.addEventListener("abort", () =>
						reject(new DOMException("Aborted", "AbortError")),
					);
				});
			},
		});
		await click(byAriaLabel("New folder inside Travel"));
		await typeName("Hotels 2");
		await click(byText("Create folder"));
		await act(async () => {
			root.unmount();
		});
		assert.equal(signal?.aborted, true);
		assert.deepEqual(selected, []);
		root = createRoot(container);
	});
});

describe("filter and keyboard", () => {
	const filterField = (): HTMLInputElement | null =>
		container.querySelector('input[type="search"]');

	const typeFilter = async (value: string) => {
		const input = filterField();
		assert.ok(input);
		const setter = Object.getOwnPropertyDescriptor(
			dom.window.HTMLInputElement.prototype,
			"value",
		)?.set;
		await act(async () => {
			setter?.call(input, value);
			input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
		});
	};

	const press = async (target: Element, key: string) => {
		await act(async () => {
			target.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", { key, bubbles: true }),
			);
		});
	};

	it("narrows to the match and keeps its parent as context, not a target", async () => {
		await mount({});
		await typeFilter("hotels");
		assert.ok(byAriaLabel("Move to Hotels"));
		assert.equal(byAriaLabel("Move to Travel"), null);
		assert.ok(byAriaLabel("Travel (containing folder)"));
		assert.equal(byAriaLabel("Move to Archive"), null);
	});

	it("says so when nothing matches", async () => {
		await mount({});
		await typeFilter("zzz");
		assert.match(container.textContent ?? "", /No folders match "zzz"/);
	});

	it("selects the focused row on Enter", async () => {
		const selected: string[] = [];
		await mount({ onSelect: (id) => selected.push(id) });
		const first = byAriaLabel("Move to Travel");
		assert.ok(first);
		await press(first, "Enter");
		assert.deepEqual(selected, ["travel"]);
	});

	it("walks the tree with the arrow keys", async () => {
		await mount({});
		const first = byAriaLabel("Move to Travel");
		assert.ok(first);
		await press(first, "ArrowDown");
		assert.equal(
			dom.window.document.activeElement?.getAttribute("aria-label"),
			"Move to Hotels",
		);
		await press(first, "End");
		assert.equal(
			dom.window.document.activeElement?.getAttribute("aria-label"),
			"Move to Archive",
		);
		await press(first, "Home");
		assert.equal(
			dom.window.document.activeElement?.getAttribute("aria-label"),
			"Move to Travel",
		);
	});

	it("cancels on Escape from the tree and from the filter", async () => {
		let cancelled = 0;
		await mount({ onCancel: () => (cancelled += 1) });
		const first = byAriaLabel("Move to Travel");
		assert.ok(first);
		await press(first, "Escape");
		const filter = filterField();
		assert.ok(filter);
		await press(filter, "Escape");
		assert.equal(cancelled, 2);
	});

	it("hands focus from the filter to the first destination on ArrowDown", async () => {
		await mount({});
		const filter = filterField();
		assert.ok(filter);
		await press(filter, "ArrowDown");
		assert.equal(
			dom.window.document.activeElement?.getAttribute("aria-label"),
			"Move to Travel",
		);
	});
});
