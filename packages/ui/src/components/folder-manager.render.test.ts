import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { FolderManager, type ManagedFolder } from "./folder-manager.js";

const folders: ManagedFolder[] = [
	{
		id: "inbox",
		label: "Inbox",
		path: "INBOX",
		deleteBlockedReason: "The inbox can't be deleted.",
	},
	{ id: "travel", label: "Travel", path: "Travel" },
	{ id: "hotels", label: "Hotels", path: "Travel/Hotels" },
	{ id: "trash", label: "Trash", path: "Deleted Messages" },
];

const render = (props: Partial<Parameters<typeof FolderManager>[0]> = {}) =>
	renderToString(
		createElement(FolderManager, {
			folders,
			onRename: () => undefined,
			onDelete: () => undefined,
			...props,
		}),
	);

describe("FolderManager", () => {
	it("browses the folders as a tree that starts at its top level", () => {
		const html = render();
		assert.match(html, /role="tree"/);
		assert.equal(html.match(/role="treeitem"/g)?.length, 3);
		assert.doesNotMatch(html, /aria-label="Hotels"/);
	});

	it("labels a folder by its role while nesting it by its real path", () => {
		const html = render();
		assert.match(html, /aria-label="Trash"/);
		assert.doesNotMatch(html, />Deleted Messages</);
	});

	it("carries a folder's reason for staying onto its delete control", () => {
		assert.match(
			render(),
			/aria-label="Delete Inbox — The inbox can&#x27;t be deleted."/,
		);
	});
});
