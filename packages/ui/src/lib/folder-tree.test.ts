import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	collapseFolderTree,
	type FolderTreeNode,
	filterFolderTree,
	folderAncestors,
	folderDepth,
	folderParent,
	matchesQuery,
	orderFolderNodes,
	queryExpandedPaths,
	withCreateRows,
} from "./folder-tree.js";

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

describe("folder paths", () => {
	it("reads the parent, the depth and the ancestors off the path", () => {
		assert.equal(folderParent("Travel/Hotels/Receipts", "/"), "Travel/Hotels");
		assert.equal(folderParent("Archive", "/"), "");
		assert.equal(folderDepth("Travel/Hotels/Receipts", "/"), 2);
		assert.deepEqual(folderAncestors("Travel/Hotels/Receipts", "/"), [
			"Travel/Hotels",
			"Travel",
		]);
	});

	it("splits on the provider's separator", () => {
		assert.equal(folderParent("Travel.Hotels", "."), "Travel");
		assert.equal(folderDepth("Travel.Hotels", "."), 1);
		assert.deepEqual(folderAncestors("Travel.Hotels", "."), ["Travel"]);
	});
});

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

	it("marks what is open on a filtered row", () => {
		const rows = filterFolderTree(ordered, "hotels", "/", new Set(["Travel"]));
		assert.deepEqual(
			rows.map((row) => row.expanded),
			[true, false],
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
