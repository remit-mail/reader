import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { folderFailure } from "./folder-failure.js";

describe("folderFailure", () => {
	it("says nothing about a folder that did not fail", () => {
		assert.equal(
			folderFailure({ syncStatus: "synced", syncFailureReason: "" }),
			undefined,
		);
	});

	it("carries the mail server's own words", () => {
		assert.equal(
			folderFailure({
				syncStatus: "failed",
				syncFailureReason: "Permission denied",
			}),
			"The mail server refused the last change: Permission denied",
		);
	});

	it("still says it failed when the server gave no reason", () => {
		assert.equal(
			folderFailure({ syncStatus: "failed", syncFailureReason: " " }),
			"The last change to this folder failed.",
		);
	});
});
