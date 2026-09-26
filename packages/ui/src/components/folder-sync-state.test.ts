import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	FolderSyncBadge,
	type FolderSyncState,
	folderSyncAriaLabel,
	folderSyncState,
	isFolderSyncNavigable,
} from "./folder-sync-state.js";

const render = (state: FolderSyncState) =>
	renderToString(createElement(FolderSyncBadge, { state }));

describe("folderSyncState", () => {
	it("reads a synced mailbox as healthy", () => {
		assert.deepEqual(
			folderSyncState({ syncStatus: "synced", hierarchyDelimiter: "/" }),
			{ kind: "healthy" },
		);
	});

	it("reads synced with a pendingPath as healthy — unreachable by invariant (D3)", () => {
		assert.deepEqual(
			folderSyncState({
				syncStatus: "synced",
				pendingPath: "Receipts",
				hierarchyDelimiter: "/",
			}),
			{ kind: "healthy" },
		);
	});

	it("reads a pending mailbox with no pendingPath as creating", () => {
		assert.deepEqual(
			folderSyncState({ syncStatus: "pending", hierarchyDelimiter: "/" }),
			{ kind: "creating" },
		);
	});

	it("reads a pending mailbox with a pendingPath as renaming, to the leaf segment", () => {
		assert.deepEqual(
			folderSyncState({
				syncStatus: "pending",
				pendingPath: "Archive/Q3 Receipts",
				hierarchyDelimiter: "/",
			}),
			{ kind: "renaming", target: "Q3 Receipts" },
		);
	});

	it("reads the leaf by the mailbox's own delimiter, not a hardcoded slash", () => {
		assert.deepEqual(
			folderSyncState({
				syncStatus: "pending",
				pendingPath: "INBOX.Archive.Q3 Receipts",
				hierarchyDelimiter: ".",
			}),
			{ kind: "renaming", target: "Q3 Receipts" },
		);
	});

	it("still reads as renaming when pendingPath equals the current fullPath — the derivation does not second-guess the server", () => {
		assert.deepEqual(
			folderSyncState({
				syncStatus: "pending",
				pendingPath: "Receipts",
				hierarchyDelimiter: "/",
			}),
			{ kind: "renaming", target: "Receipts" },
		);
	});

	it("reads a deleting mailbox as deleting", () => {
		assert.deepEqual(
			folderSyncState({ syncStatus: "deleting", hierarchyDelimiter: "/" }),
			{ kind: "deleting" },
		);
	});

	it("reads a failed mailbox with a pendingPath as rename-failed, to the leaf segment", () => {
		assert.deepEqual(
			folderSyncState({
				syncStatus: "failed",
				pendingPath: "Archive/Q3 Receipts",
				hierarchyDelimiter: "/",
			}),
			{ kind: "rename-failed", target: "Q3 Receipts" },
		);
	});

	it("reads a failed mailbox with no pendingPath as delete-failed", () => {
		assert.deepEqual(
			folderSyncState({ syncStatus: "failed", hierarchyDelimiter: "/" }),
			{ kind: "delete-failed" },
		);
	});
});

describe("folderSyncAriaLabel", () => {
	it("reads as the plain name for healthy", () => {
		assert.equal(
			folderSyncAriaLabel("Receipts", { kind: "healthy" }),
			"Receipts",
		);
	});

	it("names the folder and the state for creating", () => {
		assert.equal(
			folderSyncAriaLabel("Receipts", { kind: "creating" }),
			"Receipts — creating",
		);
	});

	it("names the folder, the state and the target for renaming", () => {
		assert.equal(
			folderSyncAriaLabel("Receipts", {
				kind: "renaming",
				target: "Q3 Receipts",
			}),
			"Receipts — renaming to Q3 Receipts",
		);
	});

	it("names the folder and the state for deleting", () => {
		assert.equal(
			folderSyncAriaLabel("Receipts", { kind: "deleting" }),
			"Receipts — deleting",
		);
	});

	it("names the folder and the state for rename-failed", () => {
		assert.equal(
			folderSyncAriaLabel("Receipts", {
				kind: "rename-failed",
				target: "Q3 Receipts",
			}),
			"Receipts — rename failed",
		);
	});

	it("names the folder and the state for delete-failed", () => {
		assert.equal(
			folderSyncAriaLabel("Receipts", { kind: "delete-failed" }),
			"Receipts — delete failed",
		);
	});
});

describe("isFolderSyncNavigable", () => {
	it("is navigable for healthy, renaming, rename-failed and delete-failed", () => {
		assert.equal(isFolderSyncNavigable({ kind: "healthy" }), true);
		assert.equal(
			isFolderSyncNavigable({ kind: "renaming", target: "Q3 Receipts" }),
			true,
		);
		assert.equal(
			isFolderSyncNavigable({
				kind: "rename-failed",
				target: "Q3 Receipts",
			}),
			true,
		);
		assert.equal(isFolderSyncNavigable({ kind: "delete-failed" }), true);
	});

	it("is not navigable for creating or deleting", () => {
		assert.equal(isFolderSyncNavigable({ kind: "creating" }), false);
		assert.equal(isFolderSyncNavigable({ kind: "deleting" }), false);
	});
});

describe("FolderSyncBadge", () => {
	it("renders nothing for healthy", () => {
		assert.equal(render({ kind: "healthy" }), "");
	});

	it("renders the creating copy", () => {
		assert.match(render({ kind: "creating" }), /Creating…/);
	});

	it("renders the renaming copy with typographic quotes around the target", () => {
		assert.match(
			render({ kind: "renaming", target: "Q3 Receipts" }),
			/Renaming to “Q3 Receipts”…/,
		);
	});

	it("renders the deleting copy", () => {
		assert.match(render({ kind: "deleting" }), /Deleting…/);
	});

	it("renders the rename-failed copy", () => {
		assert.match(
			render({ kind: "rename-failed", target: "Q3 Receipts" }),
			/Rename failed/,
		);
	});

	it("renders the delete-failed copy", () => {
		assert.match(render({ kind: "delete-failed" }), /Delete failed/);
	});
});
