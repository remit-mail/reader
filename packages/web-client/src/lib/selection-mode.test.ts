import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { shouldExitSelectionOnNavigate } from "./selection-mode.js";

describe("shouldExitSelectionOnNavigate", () => {
	test("back while selecting exits selection instead of navigating", () => {
		assert.equal(shouldExitSelectionOnNavigate("BACK", true, undefined), true);
	});

	test("back with nothing selected is left alone", () => {
		assert.equal(
			shouldExitSelectionOnNavigate("BACK", false, undefined),
			false,
		);
	});

	test("back inside the wizard pops a step instead of the selection", () => {
		assert.equal(shouldExitSelectionOnNavigate("BACK", true, "match"), false);
		assert.equal(shouldExitSelectionOnNavigate("BACK", true, "review"), false);
	});

	test("forward, push, replace and go are never blocked", () => {
		assert.equal(
			shouldExitSelectionOnNavigate("FORWARD", true, undefined),
			false,
		);
		assert.equal(shouldExitSelectionOnNavigate("PUSH", true, undefined), false);
		assert.equal(
			shouldExitSelectionOnNavigate("REPLACE", true, undefined),
			false,
		);
		assert.equal(shouldExitSelectionOnNavigate("GO", true, undefined), false);
	});
});
