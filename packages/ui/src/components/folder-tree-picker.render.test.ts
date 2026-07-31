import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { type FolderTreeNode, FolderTreePicker } from "./folder-tree-picker.js";

const node = (
	id: string,
	label: string,
	path: string,
	isCurrent?: boolean,
): FolderTreeNode => ({ id, label, path, isCurrent });

const folders: FolderTreeNode[] = [
	node("inbox", "Inbox", "INBOX", true),
	node("hotels", "Hotels", "Travel/Hotels"),
	node("archive", "Archive", "Archive"),
	node("travel", "Travel", "Travel"),
	node("receipts", "Receipts", "Travel/Hotels/Receipts"),
	node("trash", "Trash", "Deleted Messages"),
];

/** The opening tag of the element carrying `needle`, attribute order aside. */
const tagWith = (html: string, needle: string): string => {
	const at = html.indexOf(needle);
	assert.notEqual(at, -1, `not rendered: ${needle}`);
	return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
};

describe("FolderTreePicker render", () => {
	const render = (props: Partial<Parameters<typeof FolderTreePicker>[0]>) =>
		renderToString(
			createElement(FolderTreePicker, {
				folders,
				onSelect: () => {},
				...props,
			}),
		);

	it("starts at the top level, with every row closed and openable", () => {
		const html = render({});
		assert.match(html, /role="tree"/);
		assert.equal(html.match(/role="treeitem"/g)?.length, 4);
		assert.equal(html.match(/aria-expanded="false"/g)?.length, 4);
		assert.doesNotMatch(html, /aria-label="Move to Hotels"/);
		assert.match(
			tagWith(html, 'aria-label="Move to Travel"'),
			/aria-level="1"/,
		);
	});

	it("marks the current folder as a marker, never a disabled control", () => {
		const html = render({});
		assert.match(html, /aria-label="Inbox \(current folder\)"/);
		assert.match(html, /aria-current="true"/);
		assert.doesNotMatch(html, /disabled/);
	});

	it("checks the chosen row and leaves the rest unselected", () => {
		const html = render({ selectedId: "archive" });
		assert.match(
			tagWith(html, 'aria-label="Move to Archive"'),
			/aria-selected="true"/,
		);
		assert.match(
			tagWith(html, 'aria-label="Move to Travel"'),
			/aria-selected="false"/,
		);
	});

	it("offers no create affordance without onCreateFolder", () => {
		const html = render({});
		assert.doesNotMatch(html, /New folder/);
	});

	it("pins one create action above the tree and none inside a closed list", () => {
		const html = render({
			onCreateFolder: () =>
				Promise.resolve(node("made", "Made", "Travel/Made")),
		});
		assert.equal(html.match(/aria-label="New folder"/g)?.length, 1);
		assert.doesNotMatch(html, /aria-label="New folder inside/);
	});

	it("gives the pinned create action the prominent treatment", () => {
		const html = render({
			onCreateFolder: () =>
				Promise.resolve(node("made", "Made", "Travel/Made")),
		});
		assert.match(
			tagWith(html, 'aria-label="New folder"'),
			/data-prominence="prominent"/,
		);
	});

	it("says the list is empty when there is nothing to list", () => {
		const html = render({ folders: [] });
		assert.match(html, /No folders to show/);
		assert.doesNotMatch(html, /No folders match/);
	});

	it("applies caller-supplied labels", () => {
		const html = render({
			labels: { optionLabel: (label) => `Verplaats naar ${label}` },
		});
		assert.match(html, /aria-label="Verplaats naar Archive"/);
	});
});
