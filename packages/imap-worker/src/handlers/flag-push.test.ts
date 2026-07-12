import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FLAG_PUSH_MAX_ATTEMPTS, getFlagPushMaxAttempts } from "./flag-push.js";

describe("getFlagPushMaxAttempts — env-derived threshold (mirrors #1270's getBodySyncMaxAttempts / #1289's getPlacementMoveMaxAttempts)", () => {
	it("parses the CDK-injected env var", () => {
		assert.equal(getFlagPushMaxAttempts({ FLAG_PUSH_MAX_ATTEMPTS: "3" }), 3);
		assert.equal(getFlagPushMaxAttempts({ FLAG_PUSH_MAX_ATTEMPTS: "5" }), 5);
	});

	it("defaults to 3 when unset", () => {
		assert.equal(getFlagPushMaxAttempts({}), 3);
	});

	it("defaults to 3 on a non-numeric or non-positive value", () => {
		assert.equal(getFlagPushMaxAttempts({ FLAG_PUSH_MAX_ATTEMPTS: "nope" }), 3);
		assert.equal(getFlagPushMaxAttempts({ FLAG_PUSH_MAX_ATTEMPTS: "0" }), 3);
		assert.equal(getFlagPushMaxAttempts({ FLAG_PUSH_MAX_ATTEMPTS: "-1" }), 3);
	});

	it("the module-level constant reflects the actual process env at load time", () => {
		assert.equal(typeof FLAG_PUSH_MAX_ATTEMPTS, "number");
		assert.ok(FLAG_PUSH_MAX_ATTEMPTS > 0);
	});
});
