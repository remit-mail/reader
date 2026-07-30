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

	it("reads a row as the folder itself, not as a destination", () => {
		const html = render();
		assert.match(html, /aria-label="Travel"/);
		assert.doesNotMatch(html, /Move to/);
	});

	it("labels a folder by its role while nesting it by its real path", () => {
		const html = render();
		assert.match(html, /aria-label="Trash"/);
		assert.doesNotMatch(html, />Deleted Messages</);
	});

	it("offers rename and delete on every row", () => {
		const html = render();
		assert.match(html, /aria-label="Rename Travel"/);
		assert.match(html, /aria-label="Delete Travel"/);
	});

	it("carries a folder's reason for staying onto its delete control", () => {
		assert.match(
			render(),
			/aria-label="Delete Inbox — The inbox can&#x27;t be deleted."/,
		);
	});

	it("offers no create affordance without onCreateFolder", () => {
		assert.doesNotMatch(render(), /New folder/);
	});

	it("makes a folder where the user is looking once creating is wired", () => {
		const html = render({
			onCreateFolder: () =>
				Promise.resolve({ id: "made", label: "Made", path: "Made" }),
		});
		assert.match(html, /aria-label="New folder"/);
	});

	it("takes the surface's own tree name", () => {
		assert.match(
			render({ labels: { treeAriaLabel: "All folders for a@b.example" } }),
			/aria-label="All folders for a@b.example"/,
		);
	});
});
