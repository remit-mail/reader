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
	collapseFolderTree,
	queryExpandedPaths,
	withCreateRows,
	matchesQuery,
	findFirstFocusable,
	findLastFocusable,
	findNextFocusable,
	findParentRow,
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

const ordered = orderFolderNodes(folders, "/");

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

describe("collapsing", () => {
	it("shows the top level and nothing under it", () => {
		const rows = collapseFolderTree(ordered, new Set(), "/");
		assert.deepEqual(paths(rows), [
			"INBOX",
			"Archive",
			"Travel",
			"Deleted Messages",
		]);
	});

	it("reveals only the children of what is open", () => {
		const rows = collapseFolderTree(ordered, new Set(["Travel"]), "/");
		assert.deepEqual(paths(rows), [
			"INBOX",
			"Archive",
			"Travel",
			"Travel/Hotels",
			"Deleted Messages",
		]);
	});

	it("needs every ancestor open to reach a grandchild", () => {
		assert.deepEqual(
			paths(collapseFolderTree(ordered, new Set(["Travel/Hotels"]), "/")),
			["INBOX", "Archive", "Travel", "Deleted Messages"],
		);
		assert.deepEqual(
			paths(
				collapseFolderTree(ordered, new Set(["Travel", "Travel/Hotels"]), "/"),
			),
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

	it("marks what is open on the row", () => {
		const rows = collapseFolderTree(ordered, new Set(["Travel"]), "/");
		assert.deepEqual(
			rows.map((row) => row.expanded),
			[false, false, true, false, false],
		);
	});

	it("shows a folder whose parent is absent from the list", () => {
		const orphaned = orderFolderNodes(
			[
				node("archive", "Archive", "Archive"),
				node("apollo", "Apollo", "Work/Projects/Apollo"),
			],
			"/",
		);
		assert.deepEqual(paths(collapseFolderTree(orphaned, new Set(), "/")), [
			"Archive",
			"Work/Projects/Apollo",
		]);
	});
});

describe("filtering", () => {
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

	it("opens the ancestors a match hides behind", () => {
		assert.deepEqual([...queryExpandedPaths(ordered, "receipts", "/")].sort(), [
			"Travel",
			"Travel/Hotels",
		]);
	});

	it("opens nothing on an empty query, so the list stays as it was", () => {
		assert.equal(queryExpandedPaths(ordered, "", "/").size, 0);
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

describe("create rows", () => {
	const kinds = (expanded: string[]) =>
		withCreateRows(
			collapseFolderTree(ordered, new Set(expanded), "/"),
			"/",
		).map((entry) =>
			entry.kind === "create"
				? `new inside ${entry.parent.path} @${entry.depth}`
				: entry.row.folder.path,
		);

	it("offers none while everything is closed", () => {
		assert.deepEqual(kinds([]), [
			"INBOX",
			"Archive",
			"Travel",
			"Deleted Messages",
		]);
	});

	it("puts the action after the children of the folder it belongs to", () => {
		assert.deepEqual(kinds(["Travel"]), [
			"INBOX",
			"Archive",
			"Travel",
			"Travel/Hotels",
			"new inside Travel @1",
			"Deleted Messages",
		]);
	});

	it("closes the deepest branch first when several are open", () => {
		assert.deepEqual(kinds(["Travel", "Travel/Hotels"]), [
			"INBOX",
			"Archive",
			"Travel",
			"Travel/Hotels",
			"Travel/Hotels/Receipts",
			"new inside Travel/Hotels @2",
			"new inside Travel @1",
			"Deleted Messages",
		]);
	});

	it("offers the action on an open folder with no children", () => {
		assert.deepEqual(kinds(["Archive"]), [
			"INBOX",
			"Archive",
			"new inside Archive @1",
			"Travel",
			"Deleted Messages",
		]);
	});
});

describe("roving focus", () => {
	const rows = filterFolderTree(ordered, "receipts", "/");

	it("skips context rows, which are branches rather than folders to open", () => {
		assert.equal(findFirstFocusable(rows), 2);
		assert.equal(findLastFocusable(rows), 2);
	});

	it("reaches the current folder, which cannot be picked but can be opened", () => {
		const all = collapseFolderTree(ordered, new Set(), "/");
		assert.equal(findFirstFocusable(all), 0);
		assert.equal(findNextFocusable(all, 3, 1), 0);
		assert.equal(findNextFocusable(all, 0, -1), 3);
	});

	it("walks only what is on screen, so closed children are skipped", () => {
		const closed = collapseFolderTree(ordered, new Set(), "/");
		assert.equal(
			closed[findNextFocusable(closed, 2, 1)]?.folder.path,
			"Deleted Messages",
		);
		const open = collapseFolderTree(ordered, new Set(["Travel"]), "/");
		assert.equal(
			open[findNextFocusable(open, 2, 1)]?.folder.path,
			"Travel/Hotels",
		);
	});

	it("finds the parent to move focus to when a row closes", () => {
		const open = collapseFolderTree(ordered, new Set(["Travel"]), "/");
		assert.equal(findParentRow(open, 3, "/"), 2);
		assert.equal(findParentRow(open, 2, "/"), -1);
	});

	it("returns -1 when there is nothing to walk", () => {
		assert.equal(findFirstFocusable([]), -1);
		assert.equal(findLastFocusable([]), -1);
		assert.equal(findNextFocusable([], 0, 1), -1);
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
