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
			provenanceFolderLabel({
				role: "junk",
				providerPath: "Bulk Mail",
				hierarchyDelimiter: "/",
			}),
			"Spam",
		);
	});

	it("falls back to the leaf of a folder nobody appointed", () => {
		assert.equal(
			provenanceFolderLabel({
				providerPath: "Projects/Bookkeeping",
				hierarchyDelimiter: "/",
			}),
			"Bookkeeping",
		);
	});

	it("cuts the path on the delimiter the server reports, not on a slash", () => {
		assert.equal(
			provenanceFolderLabel({
				providerPath: "INBOX.Projects.Q3",
				hierarchyDelimiter: ".",
			}),
			"Q3",
		);
	});

	it("leaves a slash alone in a folder name on a dotted server", () => {
		assert.equal(
			provenanceFolderLabel({
				providerPath: "INBOX.Reading/Writing",
				hierarchyDelimiter: ".",
			}),
			"Reading/Writing",
		);
	});

	it("treats a flat namespace as one folder name", () => {
		assert.equal(
			provenanceFolderLabel({
				providerPath: "Projects/Q3",
				hierarchyDelimiter: "",
			}),
			"Projects/Q3",
		);
	});

	it("refuses to label a view rather than a place", () => {
		assert.equal(provenanceFolderLabel({ role: "all" }), undefined);
		assert.equal(provenanceFolderLabel({ role: "flagged" }), undefined);
	});

	it("refuses to label Gmail's own reserved namespace", () => {
		assert.equal(
			provenanceFolderLabel({
				providerPath: "[Gmail]/All Mail",
				hierarchyDelimiter: "/",
			}),
			undefined,
		);
		assert.equal(
			provenanceFolderLabel({
				providerPath: "[Gmail]/Starred",
				hierarchyDelimiter: "/",
			}),
			undefined,
		);
	});

	it("refuses the googlemail.com spelling of the same namespace", () => {
		assert.equal(
			provenanceFolderLabel({
				providerPath: "[Google Mail]/All Mail",
				hierarchyDelimiter: "/",
			}),
			undefined,
		);
		assert.equal(
			provenanceFolderLabel({
				providerPath: "[Google Mail]/Starred",
				hierarchyDelimiter: "/",
			}),
			undefined,
		);
	});

	it("labels a user folder that merely mentions Gmail", () => {
		assert.equal(
			provenanceFolderLabel({ providerPath: "Gmail", hierarchyDelimiter: "/" }),
			"Gmail",
		);
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
