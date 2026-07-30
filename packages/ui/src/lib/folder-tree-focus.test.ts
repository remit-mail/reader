import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	collapseFolderTree,
	type FolderTreeNode,
	filterFolderTree,
	orderFolderNodes,
} from "./folder-tree.js";
import {
	findFirstFocusable,
	findLastFocusable,
	findNextFocusable,
	findParentRow,
	isSelectable,
} from "./folder-tree-focus.js";

const node = (
	id: string,
	label: string,
	path: string,
	isCurrent?: boolean,
): FolderTreeNode => ({ id, label, path, isCurrent });

const ordered = orderFolderNodes(
	[
		node("inbox", "Inbox", "INBOX", true),
		node("hotels", "Hotels", "Travel/Hotels"),
		node("archive", "Archive", "Archive"),
		node("travel", "Travel", "Travel"),
		node("receipts", "Receipts", "Travel/Hotels/Receipts"),
		node("trash", "Trash", "Deleted Messages"),
	],
	"/",
);

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

	it("walks from nowhere into the list from either end", () => {
		const all = collapseFolderTree(ordered, new Set(), "/");
		assert.equal(findNextFocusable(all, -1, 1), 0);
		assert.equal(findNextFocusable(all, -1, -1), 3);
	});

	it("finds the parent to move focus to when a row closes", () => {
		const open = collapseFolderTree(ordered, new Set(["Travel"]), "/");
		assert.equal(findParentRow(open, 3, "/"), 2);
		assert.equal(findParentRow(open, 2, "/"), -1);
	});

	it("finds no parent for a row that is not on screen", () => {
		const open = collapseFolderTree(ordered, new Set(["Travel"]), "/");
		assert.equal(findParentRow(open, 99, "/"), -1);
		assert.equal(
			findParentRow(filterFolderTree(ordered, "hotels", "/"), 1, "/"),
			-1,
		);
	});

	it("returns -1 when there is nothing to walk", () => {
		assert.equal(findFirstFocusable([]), -1);
		assert.equal(findLastFocusable([]), -1);
		assert.equal(findNextFocusable([], 0, 1), -1);
	});

	it("keeps the current folder and a context branch out of the selection", () => {
		const all = collapseFolderTree(ordered, new Set(), "/");
		assert.equal(isSelectable(all[0]), false);
		assert.equal(isSelectable(all[1]), true);
		assert.equal(isSelectable(rows[0]), false);
		assert.equal(isSelectable(undefined), false);
	});
});
