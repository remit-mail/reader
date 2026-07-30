import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	type FolderTreeNode,
	FolderTreePicker,
	folderTreePickerInternals,
} from "./folder-tree-picker.js";

const {
	orderFolderNodes,
	filterFolderTree,
	matchesQuery,
	findFirstSelectable,
	findLastSelectable,
	findNextSelectable,
} = folderTreePickerInternals;

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

const paths = (rows: readonly { folder: FolderTreeNode }[]): string[] =>
	rows.map((row) => row.folder.path);

/** The opening tag of the element carrying `needle`, attribute order aside. */
const tagWith = (html: string, needle: string): string => {
	const at = html.indexOf(needle);
	assert.notEqual(at, -1, `not rendered: ${needle}`);
	return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
};

describe("folder ordering", () => {
	it("puts every child straight after its parent", () => {
		assert.deepEqual(
			orderFolderNodes(folders, "/").map((folder) => folder.path),
			[
				"INBOX",
				"Archive",
				"Travel",
				"Travel/Hotels",
				"Travel/Hotels/Receipts",
				"Deleted Messages",
			],
		);
	});

	it("renders a folder whose parent is absent as a root", () => {
		const orphaned = [
			node("archive", "Archive", "Archive"),
			node("apollo", "Apollo", "Work/Projects/Apollo"),
		];
		assert.deepEqual(
			orderFolderNodes(orphaned, "/").map((folder) => folder.path),
			["Archive", "Work/Projects/Apollo"],
		);
	});

	it("nests on the provider's separator", () => {
		const dotted = [
			node("child", "Hotels", "Travel.Hotels"),
			node("other", "Archive", "Archive"),
			node("parent", "Travel", "Travel"),
		];
		assert.deepEqual(
			orderFolderNodes(dotted, ".").map((folder) => folder.path),
			["Archive", "Travel", "Travel.Hotels"],
		);
	});
});

describe("filtering", () => {
	const ordered = orderFolderNodes(folders, "/");

	it("matches on the label", () => {
		assert.equal(matchesQuery(node("a", "Archive", "Archive"), "arch"), true);
	});

	it("matches on the path, so a role-labelled folder is still findable", () => {
		assert.equal(
			matchesQuery(node("t", "Trash", "Deleted Messages"), "deleted"),
			true,
		);
	});

	it("keeps the ancestors of a match on screen", () => {
		const rows = filterFolderTree(ordered, "receipts", "/");
		assert.deepEqual(paths(rows), [
			"Travel",
			"Travel/Hotels",
			"Travel/Hotels/Receipts",
		]);
	});

	it("marks an ancestor kept for context as no match of its own", () => {
		const rows = filterFolderTree(ordered, "receipts", "/");
		assert.deepEqual(
			rows.map((row) => row.context),
			[true, true, false],
		);
	});

	it("keeps a matching ancestor a match", () => {
		const rows = filterFolderTree(ordered, "travel", "/");
		assert.deepEqual(
			rows.map((row) => row.context),
			[false, false, false],
		);
	});

	it("carries the depth the row indents by", () => {
		const rows = filterFolderTree(ordered, "", "/");
		assert.deepEqual(
			rows.map((row) => row.depth),
			[0, 0, 0, 1, 2, 0],
		);
	});

	it("narrows to nothing when the query matches no folder", () => {
		assert.deepEqual(filterFolderTree(ordered, "zzz", "/"), []);
	});
});

describe("roving focus", () => {
	const rows = filterFolderTree(
		orderFolderNodes(folders, "/"),
		"receipts",
		"/",
	);

	it("skips context rows when finding the first destination", () => {
		assert.equal(findFirstSelectable(rows), 2);
	});

	it("finds the last destination", () => {
		assert.equal(findLastSelectable(rows), 2);
	});

	it("skips the current folder", () => {
		const all = filterFolderTree(orderFolderNodes(folders, "/"), "", "/");
		assert.equal(findFirstSelectable(all), 1);
		assert.equal(findNextSelectable(all, 5, 1), 1);
		assert.equal(findNextSelectable(all, 1, -1), 5);
	});

	it("returns -1 when nothing is selectable", () => {
		const only = filterFolderTree(
			orderFolderNodes([node("inbox", "Inbox", "INBOX", true)], "/"),
			"",
			"/",
		);
		assert.equal(findFirstSelectable(only), -1);
		assert.equal(findLastSelectable(only), -1);
		assert.equal(findNextSelectable(only, 0, 1), -1);
		assert.equal(findNextSelectable([], 0, 1), -1);
	});
});

describe("FolderTreePicker render", () => {
	const render = (props: Partial<Parameters<typeof FolderTreePicker>[0]>) =>
		renderToString(
			createElement(FolderTreePicker, {
				folders,
				onSelect: () => {},
				...props,
			}),
		);

	it("renders the folders as a tree with a level per row", () => {
		const html = render({});
		assert.match(html, /role="tree"/);
		assert.equal(html.match(/role="treeitem"/g)?.length, 6);
		assert.match(
			tagWith(html, 'aria-label="Move to Hotels"'),
			/aria-level="2"/,
		);
		assert.match(
			tagWith(html, 'aria-label="Move to Receipts"'),
			/aria-level="3"/,
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

	it("offers a create row at the top and one per folder", () => {
		const html = render({
			onCreateFolder: () =>
				Promise.resolve(node("made", "Made", "Travel/Made")),
		});
		assert.match(html, /New folder<\/button>/);
		assert.match(html, /aria-label="New folder inside Travel"/);
		assert.match(html, /aria-label="New folder inside Inbox"/);
	});

	it("renders the empty state when no folder matches", () => {
		const html = render({ folders: [] });
		assert.match(html, /No folders match/);
	});

	it("applies caller-supplied labels", () => {
		const html = render({
			labels: { optionLabel: (label) => `Verplaats naar ${label}` },
		});
		assert.match(html, /aria-label="Verplaats naar Archive"/);
	});
});
