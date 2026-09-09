import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	composeFolderPath,
	type FolderTarget,
	validateNewFolderName,
} from "./new-folder.js";

const parent: FolderTarget = { fullPath: "INBOX", hierarchyDelimiter: "/" };

describe("composeFolderPath", () => {
	it("returns the trimmed name for a root folder", () => {
		assert.equal(composeFolderPath("  Receipts  "), "Receipts");
	});

	it("joins the parent path by the parent's delimiter", () => {
		assert.equal(composeFolderPath("Receipts", parent), "INBOX/Receipts");
	});

	it("honours a non-slash delimiter", () => {
		assert.equal(
			composeFolderPath("Receipts", {
				fullPath: "INBOX",
				hierarchyDelimiter: ".",
			}),
			"INBOX.Receipts",
		);
	});
});

describe("validateNewFolderName", () => {
	const base = { delimiter: "/", existingPaths: ["INBOX", "INBOX/Archive"] };

	it("rejects an empty or whitespace name", () => {
		assert.match(
			validateNewFolderName({ ...base, name: "   " }) ?? "",
			/Enter a folder name/,
		);
	});

	it("rejects a name containing the hierarchy delimiter", () => {
		assert.match(
			validateNewFolderName({ ...base, name: "a/b" }) ?? "",
			/can't contain/,
		);
	});

	it("rejects a name that would contain a non-slash delimiter", () => {
		assert.match(
			validateNewFolderName({
				delimiter: ".",
				existingPaths: [],
				name: "a.b",
			}) ?? "",
			/can't contain/,
		);
	});

	it("rejects an exact collision with an existing path", () => {
		assert.match(
			validateNewFolderName({
				...base,
				name: "Archive",
				parent,
			}) ?? "",
			/already exists/,
		);
	});

	it("rejects a root name that collides with an existing top-level fullPath", () => {
		assert.match(
			validateNewFolderName({
				delimiter: "/",
				existingPaths: ["Work"],
				name: "Work",
			}) ?? "",
			/already exists/,
		);
	});

	it("treats INBOX case-insensitively for collisions", () => {
		assert.match(
			validateNewFolderName({
				delimiter: "/",
				existingPaths: ["INBOX"],
				name: "inbox",
			}) ?? "",
			/already exists/,
		);
	});

	it("compares non-INBOX segments case-sensitively", () => {
		assert.equal(
			validateNewFolderName({
				delimiter: "/",
				existingPaths: ["Work"],
				name: "work",
			}),
			undefined,
		);
	});

	it("accepts a valid new nested folder", () => {
		assert.equal(
			validateNewFolderName({ ...base, name: "Receipts", parent }),
			undefined,
		);
	});
});

describe("validateNewFolderName in a flat namespace", () => {
	const flat = { delimiter: "", existingPaths: ["INBOX", "Archive"] };

	it("accepts a name when the server reports no delimiter", () => {
		assert.equal(
			validateNewFolderName({ ...flat, name: "Receipts" }),
			undefined,
		);
	});

	it("still catches a collision", () => {
		assert.match(
			validateNewFolderName({ ...flat, name: "inbox" }) ?? "",
			/already exists/,
		);
	});
});
