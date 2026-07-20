import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isVirtualFolderRole, provenanceFolderLabel } from "./folder-role.js";

describe("provenanceFolderLabel", () => {
	it("names an appointed role by its canonical label", () => {
		assert.equal(provenanceFolderLabel({ role: "archive" }), "Archive");
		assert.equal(provenanceFolderLabel({ role: "sent" }), "Sent");
	});

	it("reads a junk appointment as Spam whatever the server calls it", () => {
		assert.equal(
			provenanceFolderLabel({ role: "junk", providerPath: "Bulk Mail" }),
			"Spam",
		);
	});

	it("falls back to the leaf of a folder nobody appointed", () => {
		assert.equal(
			provenanceFolderLabel({ providerPath: "Projects/Bookkeeping" }),
			"Bookkeeping",
		);
	});

	it("refuses to label a view rather than a place", () => {
		assert.equal(provenanceFolderLabel({ role: "all" }), undefined);
		assert.equal(provenanceFolderLabel({ role: "flagged" }), undefined);
	});

	it("refuses to label Gmail's own reserved namespace", () => {
		assert.equal(
			provenanceFolderLabel({ providerPath: "[Gmail]/All Mail" }),
			undefined,
		);
		assert.equal(
			provenanceFolderLabel({ providerPath: "[Gmail]/Starred" }),
			undefined,
		);
	});

	it("labels a user folder that merely mentions Gmail", () => {
		assert.equal(provenanceFolderLabel({ providerPath: "Gmail" }), "Gmail");
	});

	it("has nothing to say about a folder it knows nothing about", () => {
		assert.equal(provenanceFolderLabel({}), undefined);
	});
});

describe("isVirtualFolderRole", () => {
	it("counts All Mail and Starred as views", () => {
		assert.equal(isVirtualFolderRole("all"), true);
		assert.equal(isVirtualFolderRole("flagged"), true);
	});

	it("counts real folders as places", () => {
		assert.equal(isVirtualFolderRole("inbox"), false);
		assert.equal(isVirtualFolderRole("junk"), false);
		assert.equal(isVirtualFolderRole("trash"), false);
	});
});
