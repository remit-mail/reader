import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isStorageNotFoundError } from "./message.js";

describe("isStorageNotFoundError", () => {
	it("matches S3 NoSuchKey via .name", () => {
		const err = Object.assign(new Error("missing"), { name: "NoSuchKey" });
		assert.equal(isStorageNotFoundError(err), true);
	});

	it("matches S3 NoSuchKey via .Code", () => {
		const err = { Code: "NoSuchKey", message: "missing" };
		assert.equal(isStorageNotFoundError(err), true);
	});

	it("matches filesystem ENOENT", () => {
		const err = Object.assign(new Error("no such file"), { code: "ENOENT" });
		assert.equal(isStorageNotFoundError(err), true);
	});

	it("does not match generic errors", () => {
		assert.equal(isStorageNotFoundError(new Error("boom")), false);
	});

	it("does not match other S3 errors", () => {
		const err = Object.assign(new Error("denied"), { name: "AccessDenied" });
		assert.equal(isStorageNotFoundError(err), false);
	});

	it("does not match non-objects", () => {
		assert.equal(isStorageNotFoundError(null), false);
		assert.equal(isStorageNotFoundError(undefined), false);
		assert.equal(isStorageNotFoundError("oops"), false);
	});
});
