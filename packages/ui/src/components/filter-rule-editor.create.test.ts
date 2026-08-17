/**
 * The move-to destination as the browsable folder tree: what it says before a
 * folder is chosen, that a nested folder is told apart from a same-named
 * sibling, and that a folder can be made inside another one from here. Mounted
 * against jsdom for the tree interaction, the create form state and the async
 * resolve.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FilterRule, PreviewCount } from "./filter-rule.js";
import { FilterRuleEditor } from "./filter-rule-editor.js";
import type { FolderTreeNode } from "./folder-tree-picker.js";

// `Prullenbak` labelled Trash is the account's own naming; two folders named
// Receipts at different depths are what a flat list of leaf names cannot tell
// apart.
const folders: FolderTreeNode[] = [
	{ id: "mbx-inbox", label: "Inbox", path: "INBOX" },
	{ id: "mbx-trash", label: "Trash", path: "INBOX/Prullenbak" },
	{ id: "mbx-receipts", label: "Receipts", path: "INBOX/Receipts" },
	{ id: "mbx-travel", label: "Travel", path: "INBOX/Travel" },
	{
		id: "mbx-travel-receipts",
		label: "Receipts",
		path: "INBOX/Travel/Receipts",
	},
];

const rule: FilterRule = {
	clauses: [{ id: "c1", field: "From", value: "a@example.com" }],
	matchOperator: "all",
	scope: "once",
};

const preview: PreviewCount = { status: "ready", count: 3 };

let container: HTMLElement;
let root: Root;

beforeEach(() => {
	container = document.getElementById("root") as unknown as HTMLElement;
	container.innerHTML = "";
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => {
		root.unmount();
	});
});

interface MountOptions {
	/** The destination the rule already carries when the editor opens. */
	initialDestination?: string;
	onCreateFolder?: (
		name: string,
		parentPath: string,
		signal?: AbortSignal,
	) => Promise<FolderTreeNode>;
	onChangeMove?: (id: string) => void;
}

/** Holds the destination the way the app does, so a pick shows on screen. */
const mount = async ({
	initialDestination,
	onCreateFolder,
	onChangeMove,
}: MountOptions = {}) => {
	const Controlled = () => {
		const [moveMailboxId, setMoveMailboxId] = useState<string | undefined>(
			initialDestination,
		);
		return createElement(FilterRuleEditor, {
			rule: { ...rule, moveMailboxId },
			folders,
			preview,
			onChangeMove: (id: string) => {
				setMoveMailboxId(id || undefined);
				onChangeMove?.(id);
			},
			onCreateFolder,
			onCommit: () => {},
			onCancel: () => {},
		});
	};
	await act(async () => {
		root.render(createElement(Controlled));
	});
};

const click = async (element: Element | null | undefined) => {
	if (!(element instanceof HTMLElement)) assert.fail("control not rendered");
	await act(async () => {
		element.click();
	});
};

const byAriaLabel = (label: string): HTMLElement | null =>
	container.querySelector(`[aria-label="${label}"]`);

const byText = (text: string): HTMLButtonElement | undefined =>
	Array.from(container.querySelectorAll("button")).find(
		(candidate) => candidate.textContent?.trim() === text,
	);

const rows = (): HTMLElement[] =>
	Array.from(container.querySelectorAll('[role="treeitem"]'));

const receiptRows = (): HTMLElement[] =>
	rows().filter((row) => row.getAttribute("aria-label") === "Move to Receipts");

const rowLabels = (): string[] =>
	rows().map((row) => row.getAttribute("aria-label") ?? "");

const openTree = async () => {
	await click(byText("Choose a folder"));
};

const openFolder = async (label: string) => {
	await click(byAriaLabel(`Move to ${label}`));
};

const nameField = (): HTMLInputElement | null => {
	const label = Array.from(container.querySelectorAll("label")).find(
		(node) => node.textContent?.trim() === "Folder name",
	);
	const id = label?.getAttribute("for");
	return id
		? (container.querySelector(`input[id="${id}"]`) as HTMLInputElement | null)
		: null;
};

const typeName = async (value: string) => {
	const input = nameField();
	assert.ok(input, "the folder name field is on screen");
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)?.set?.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
};

describe("FilterRuleEditor move destination", () => {
	it("keeps the tree closed until a destination is asked for", async () => {
		await mount();
		assert.equal(rows().length, 0);
		assert.match(container.textContent ?? "", /No folder yet/);
		await openTree();
		assert.ok(rows().length > 0, "the folder tree is on screen");
	});

	it("names a folder as the account names it, not as the provider paths it", async () => {
		await mount();
		await openTree();
		await openFolder("Inbox");
		assert.ok(
			rowLabels().includes("Move to Trash"),
			"the renamed folder reads as Trash",
		);
		assert.ok(
			!rowLabels().some((label) => label.includes("Prullenbak")),
			"the provider leaf is never what the row reads as",
		);
	});

	it("tells a nested folder apart from its same-named sibling", async () => {
		await mount();
		await openTree();
		await openFolder("Inbox");
		// The nested Receipts is out of reach until Travel is opened, so the two
		// same-named folders are never two identical entries in one list.
		assert.equal(receiptRows().length, 1);
		await openFolder("Travel");
		const nested = receiptRows();
		assert.equal(nested.length, 2);
		assert.deepEqual(
			nested.map((row) => row.getAttribute("aria-level")),
			["2", "3"],
		);
		await click(nested[1]);
		assert.ok(
			byText("Move matches to Inbox / Travel / Receipts"),
			"the destination reads as its trail, not a bare leaf name",
		);
	});

	it("re-points the rule only on the confirmation, never on the way past", async () => {
		const picked: string[] = [];
		await mount({ onChangeMove: (id) => picked.push(id) });
		await openTree();
		await openFolder("Inbox");
		await openFolder("Travel");
		await click(receiptRows()[1]);
		assert.deepEqual(picked, [], "browsing changes nothing");
		await click(byText("Move matches to Inbox / Travel / Receipts"));
		assert.deepEqual(picked, ["mbx-travel-receipts"]);
	});

	it("leaves the destination alone when the tree is cancelled", async () => {
		const picked: string[] = [];
		await mount({ onChangeMove: (id) => picked.push(id) });
		await openTree();
		await openFolder("Inbox");
		await click(byAriaLabel("Move to Trash"));
		await click(byText("Cancel"));
		assert.deepEqual(picked, []);
		assert.match(container.textContent ?? "", /No folder yet/);
	});

	it("opens on the branch holding the destination the rule already has", async () => {
		await mount({ initialDestination: "mbx-travel-receipts" });
		assert.match(container.textContent ?? "", /Inbox \/ Travel \/ Receipts/);
		await openTree();
		const selected = rows().filter(
			(row) => row.getAttribute("aria-selected") === "true",
		);
		assert.deepEqual(
			selected.map((row) => row.getAttribute("aria-level")),
			["3"],
		);
	});

	it("drops the move action so a rule can apply a label alone", async () => {
		const picked: string[] = [];
		await mount({
			initialDestination: "mbx-receipts",
			onChangeMove: (id) => picked.push(id),
		});
		await click(byText("Don't move matches"));
		assert.deepEqual(picked, [""]);
	});

	it("offers no create affordance without onCreateFolder", async () => {
		await mount();
		await openTree();
		assert.equal(byAriaLabel("New folder"), null);
	});

	it("creates a folder inside another and makes it the destination", async () => {
		const created: { name: string; parentPath: string }[] = [];
		const picked: string[] = [];
		await mount({
			onChangeMove: (id) => picked.push(id),
			onCreateFolder: async (name, parentPath) => {
				created.push({ name, parentPath });
				return {
					id: "mbx-created",
					label: name,
					path: `${parentPath}/${name}`,
				};
			},
		});
		await openTree();
		await openFolder("Inbox");
		await openFolder("Travel");
		await click(byAriaLabel("New folder inside Travel"));
		await typeName("Car hire");
		await click(byText("Create folder"));
		assert.deepEqual(created, [
			{ name: "Car hire", parentPath: "INBOX/Travel" },
		]);
		await click(byText("Move matches to Inbox / Travel / Car hire"));
		assert.deepEqual(picked, ["mbx-created"]);
	});

	it("offers a created folder before the caller's folder list refetches", async () => {
		await mount({
			onCreateFolder: async (name, parentPath) => ({
				id: "mbx-created",
				label: name,
				path: parentPath ? `${parentPath}/${name}` : name,
			}),
		});
		await openTree();
		await click(byAriaLabel("New folder"));
		await typeName("Receipts 2026");
		await click(byText("Create folder"));
		await click(byText("Move matches to Receipts 2026"));
		assert.match(container.textContent ?? "", /Receipts 2026/);
	});

	it("states a failed create where it happened and binds no destination", async () => {
		const picked: string[] = [];
		await mount({
			onChangeMove: (id) => picked.push(id),
			onCreateFolder: async () => {
				throw new Error("A folder with that name already exists.");
			},
		});
		await openTree();
		await click(byAriaLabel("New folder"));
		await typeName("Receipts");
		await click(byText("Create folder"));
		assert.deepEqual(picked, []);
		assert.ok(nameField(), "the name field stays open");
		assert.match(
			container.querySelector('[role="alert"]')?.textContent ?? "",
			/already exists/,
		);
	});
});
