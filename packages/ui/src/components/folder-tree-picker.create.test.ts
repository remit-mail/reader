/**
 * Opening folders, and the inline create form that sits at the end of an opened
 * folder's children: where it opens, what it says the parent is, and how it
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
	useState as reactUseState,
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
let useState: typeof reactUseState;
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
	useState = react.useState;
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

type PickerProps = Partial<Parameters<typeof FolderTreePickerType>[0]>;

const mount = async (props: PickerProps = {}) => {
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

/** Holds the chosen destination the way the app does, so a tap can be undone. */
const mountControlled = async (props: PickerProps = {}) => {
	const Controlled = () => {
		const [selected, setSelected] = useState<string>();
		return createElement(FolderTreePicker, {
			folders,
			selectedId: selected,
			onSelect: setSelected,
			...props,
		});
	};
	await act(async () => {
		root.render(createElement(Controlled));
	});
};

const click = async (element: Element | null | undefined) => {
	assert.ok(element, "control not rendered");
	await act(async () => {
		(element as HTMLElement).click();
	});
};

const focus = async (element: Element | null | undefined) => {
	assert.ok(element, "control not rendered");
	await act(async () => {
		(element as HTMLElement).focus();
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

const open = async (...labels: string[]) => {
	for (const label of labels) {
		await click(byAriaLabel(`Move to ${label}`));
	}
};

/** The block holding a folder's create action and any form opened from it. */
const createBlockOf = (label: string): Element | null =>
	byAriaLabel(`New folder inside ${label}`)?.closest('[role="none"]') ?? null;

const rowOf = (label: string): Element | null =>
	byAriaLabel(`Move to ${label}`)?.closest('[role="none"]') ?? null;

const created = (name: string, parentPath: string): FolderTreeNode => ({
	id: "made",
	label: name,
	path: parentPath ? `${parentPath}/${name}` : name,
});

const resolving = (name: string, parentPath: string) =>
	Promise.resolve(created(name, parentPath));

describe("opening folders", () => {
	it("starts at the top level with everything closed", async () => {
		await mount({});
		assert.ok(byAriaLabel("Move to Travel"));
		assert.ok(byAriaLabel("Move to Archive"));
		assert.equal(byAriaLabel("Move to Hotels"), null);
		assert.equal(
			byAriaLabel("Move to Travel")?.getAttribute("aria-expanded"),
			"false",
		);
	});

	it("picks the destination and opens it in one tap", async () => {
		const selected: string[] = [];
		await mount({ onSelect: (id) => selected.push(id) });
		await open("Travel");
		assert.deepEqual(selected, ["travel"]);
		assert.ok(byAriaLabel("Move to Hotels"));
		assert.equal(
			byAriaLabel("Move to Travel")?.getAttribute("aria-expanded"),
			"true",
		);
		assert.equal(
			byAriaLabel("Move to Hotels")?.getAttribute("aria-level"),
			"2",
		);
	});

	it("closes on a second tap and keeps the destination", async () => {
		await mountControlled();
		await open("Travel");
		assert.equal(
			byAriaLabel("Move to Travel")?.getAttribute("aria-selected"),
			"true",
		);
		await open("Travel");
		assert.equal(byAriaLabel("Move to Hotels"), null);
		assert.equal(
			byAriaLabel("Move to Travel")?.getAttribute("aria-selected"),
			"true",
		);
		assert.equal(
			byAriaLabel("Move to Travel")?.getAttribute("aria-expanded"),
			"false",
		);
	});

	it("opens the current folder without ever picking it", async () => {
		const selected: string[] = [];
		await mount({ onSelect: (id) => selected.push(id) });
		await click(byAriaLabel("Inbox (current folder)"));
		assert.deepEqual(selected, []);
		assert.equal(
			byAriaLabel("Inbox (current folder)")?.getAttribute("aria-expanded"),
			"true",
		);
	});
});

describe("create form anchoring", () => {
	it("offers the action at the end of an opened folder's children", async () => {
		await mount({ onCreateFolder: resolving });
		assert.equal(byAriaLabel("New folder inside Travel"), null);
		await open("Travel");
		assert.ok(byAriaLabel("New folder inside Travel"));
		assert.equal(byAriaLabel("New folder inside Hotels"), null);
	});

	it("opens the form under the action it was pressed from", async () => {
		await mount({ onCreateFolder: resolving });
		await open("Travel");
		await click(byAriaLabel("New folder inside Travel"));
		assert.ok(createBlockOf("Travel")?.querySelector("input"));
		assert.equal(rowOf("Travel")?.querySelector("input"), null);
	});

	it("states the parent as fixed text rather than a second choice", async () => {
		await mount({ onCreateFolder: resolving });
		await open("Travel");
		await click(byAriaLabel("New folder inside Travel"));
		assert.match(createBlockOf("Travel")?.textContent ?? "", /Inside\s*Travel/);
		assert.equal(container.querySelector("select"), null);
	});

	it("moves the form when the action inside another folder opens it", async () => {
		await mount({ onCreateFolder: resolving });
		await open("Travel", "Hotels");
		await click(byAriaLabel("New folder inside Travel"));
		await click(byAriaLabel("New folder inside Hotels"));
		assert.equal(createBlockOf("Travel")?.querySelector("input"), null);
		assert.ok(createBlockOf("Hotels")?.querySelector("input"));
	});

	it("creates at top level from the action pinned above the tree", async () => {
		await mount({ onCreateFolder: resolving });
		await click(byAriaLabel("New folder"));
		assert.ok(nameField());
		assert.match(container.textContent ?? "", /Inside\s*Top level/);
	});

	it("offers a subfolder inside the current folder", async () => {
		await mount({ onCreateFolder: resolving });
		await click(byAriaLabel("Inbox (current folder)"));
		assert.ok(byAriaLabel("New folder inside Inbox"));
	});

	it("closes on Cancel", async () => {
		await mount({ onCreateFolder: resolving });
		await open("Travel");
		await click(byAriaLabel("New folder inside Travel"));
		await click(byText("Cancel"));
		assert.equal(nameField(), null);
	});
});

describe("create wait", () => {
	it("passes the opened folder's path as the parent and selects what comes back", async () => {
		const calls: Array<[string, string]> = [];
		const selected: string[] = [];
		await mount({
			onSelect: (id) => selected.push(id),
			onCreateFolder: (name, parentPath) => {
				calls.push([name, parentPath]);
				return Promise.resolve(created(name, parentPath));
			},
		});
		await open("Travel");
		await click(byAriaLabel("New folder inside Travel"));
		await typeName("Hotels 2");
		await click(byText("Create folder"));
		assert.deepEqual(calls, [["Hotels 2", "Travel"]]);
		assert.deepEqual(selected, ["travel", "made"]);
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
		await open("Travel");
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
		await open("Travel");
		await click(byAriaLabel("New folder inside Travel"));
		await typeName("Hotels 2");
		await click(byText("Create folder"));
		const alert = container.querySelector('[role="alert"]');
		assert.equal(alert?.textContent, "The mail server refused that name.");
		assert.ok(createBlockOf("Travel")?.querySelector("input"));
	});

	it("says what is missing instead of going dead on an empty name", async () => {
		let attempts = 0;
		await mount({
			onCreateFolder: (n, p) => {
				attempts += 1;
				return Promise.resolve(created(n, p));
			},
		});
		await open("Travel");
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
		await click(byAriaLabel("New folder"));
		await typeName("Insurance");
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

	const press = async (target: Element | null | undefined, key: string) => {
		assert.ok(target, "control not rendered");
		await act(async () => {
			target.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", { key, bubbles: true }),
			);
		});
	};

	const focused = (): string | null =>
		dom.window.document.activeElement?.getAttribute("aria-label") ?? null;

	it("opens the ancestors a match hides behind", async () => {
		await mount({});
		assert.equal(byAriaLabel("Move to Hotels"), null);
		await typeFilter("hotels");
		assert.ok(byAriaLabel("Move to Hotels"));
		assert.equal(byAriaLabel("Move to Travel"), null);
		assert.ok(byAriaLabel("Travel (containing folder)"));
		assert.equal(
			byAriaLabel("Travel (containing folder)")?.getAttribute("aria-expanded"),
			"true",
		);
		assert.equal(byAriaLabel("Move to Archive"), null);
	});

	it("puts the list back the way it was left when the filter clears", async () => {
		await mount({});
		await open("Travel");
		await typeFilter("archive");
		assert.equal(byAriaLabel("Move to Hotels"), null);
		await typeFilter("");
		assert.ok(byAriaLabel("Move to Hotels"));
	});

	it("says so when nothing matches", async () => {
		await mount({});
		await typeFilter("zzz");
		assert.match(container.textContent ?? "", /No folders match "zzz"/);
	});

	it("picks and opens the focused row on Enter", async () => {
		const selected: string[] = [];
		await mount({ onSelect: (id) => selected.push(id) });
		await focus(byAriaLabel("Move to Travel"));
		await press(byAriaLabel("Move to Travel"), "Enter");
		assert.deepEqual(selected, ["travel"]);
		assert.ok(byAriaLabel("Move to Hotels"));
	});

	it("opens on Right and closes on Left without picking anything", async () => {
		const selected: string[] = [];
		await mount({ onSelect: (id) => selected.push(id) });
		await focus(byAriaLabel("Move to Travel"));
		await press(byAriaLabel("Move to Travel"), "ArrowRight");
		assert.ok(byAriaLabel("Move to Hotels"));
		await press(byAriaLabel("Move to Travel"), "ArrowRight");
		assert.equal(focused(), "Move to Hotels");
		await press(byAriaLabel("Move to Hotels"), "ArrowLeft");
		assert.equal(focused(), "Move to Travel");
		await press(byAriaLabel("Move to Travel"), "ArrowLeft");
		assert.equal(byAriaLabel("Move to Hotels"), null);
		assert.deepEqual(selected, []);
	});

	it("walks only the rows on screen with the arrow keys", async () => {
		await mount({});
		await focus(byAriaLabel("Inbox (current folder)"));
		await press(byAriaLabel("Inbox (current folder)"), "ArrowDown");
		assert.equal(focused(), "Move to Travel");
		await press(byAriaLabel("Move to Travel"), "ArrowDown");
		assert.equal(focused(), "Move to Archive");
		await press(byAriaLabel("Move to Archive"), "Home");
		assert.equal(focused(), "Inbox (current folder)");
		await press(byAriaLabel("Inbox (current folder)"), "End");
		assert.equal(focused(), "Move to Archive");
	});

	it("cancels on Escape from the tree and from the filter", async () => {
		let cancelled = 0;
		await mount({ onCancel: () => (cancelled += 1) });
		await press(byAriaLabel("Move to Travel"), "Escape");
		await press(filterField(), "Escape");
		assert.equal(cancelled, 2);
	});

	it("hands focus from the filter to the first row on ArrowDown", async () => {
		await mount({});
		await press(filterField(), "ArrowDown");
		assert.equal(focused(), "Inbox (current folder)");
	});
});
