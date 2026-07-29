import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	deriveIsMultiSelectMode,
	shouldExitSelectionOnNavigate,
} from "./selection-mode.js";

describe("deriveIsMultiSelectMode", () => {
	test("no selection is not multi-select mode", () => {
		assert.equal(deriveIsMultiSelectMode(0, false), false);
	});

	test("any selection on touch is multi-select mode", () => {
		assert.equal(deriveIsMultiSelectMode(1, false), true);
		assert.equal(deriveIsMultiSelectMode(42, false), true);
	});

	test("desktop selection drives the desktop toolbar, not multi-select mode", () => {
		assert.equal(deriveIsMultiSelectMode(1, true), false);
		assert.equal(deriveIsMultiSelectMode(0, true), false);
	});

	test("dropping the last selected id leaves the mode in the same call", () => {
		assert.equal(deriveIsMultiSelectMode(1, false), true);
		assert.equal(deriveIsMultiSelectMode(0, false), false);
	});
});

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
