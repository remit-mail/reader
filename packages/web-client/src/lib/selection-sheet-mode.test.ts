import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	resolveSelectionSheetMode,
	SELECTION_SHEET_MIN_COUNT,
	shouldShowSelectionSheet,
} from "./selection-sheet-mode";

describe("resolveSelectionSheetMode", () => {
	test("is idle for a plain bounded selection", () => {
		assert.equal(
			resolveSelectionSheetMode({
				isRunning: false,
				isCounting: false,
				isEscalated: false,
			}),
			"idle",
		);
	});

	test("is escalated once the selection is the search predicate", () => {
		assert.equal(
			resolveSelectionSheetMode({
				isRunning: false,
				isCounting: false,
				isEscalated: true,
			}),
			"escalated",
		);
	});

	test("is counting while the predicate is still paging to a total", () => {
		assert.equal(
			resolveSelectionSheetMode({
				isRunning: false,
				isCounting: true,
				isEscalated: false,
			}),
			"counting",
		);
	});

	test("running wins over escalated — a chunked run is both", () => {
		assert.equal(
			resolveSelectionSheetMode({
				isRunning: true,
				isCounting: false,
				isEscalated: true,
			}),
			"running",
		);
	});

	test("running wins over counting", () => {
		assert.equal(
			resolveSelectionSheetMode({
				isRunning: true,
				isCounting: true,
				isEscalated: false,
			}),
			"running",
		);
	});

	test("counting wins over escalated", () => {
		assert.equal(
			resolveSelectionSheetMode({
				isRunning: false,
				isCounting: true,
				isEscalated: true,
			}),
			"counting",
		);
	});
});

describe("shouldShowSelectionSheet", () => {
	test("hides at a single selected row while idle", () => {
		assert.equal(shouldShowSelectionSheet(1, "idle"), false);
	});

	test("shows at the two-row threshold", () => {
		assert.equal(
			shouldShowSelectionSheet(SELECTION_SHEET_MIN_COUNT, "idle"),
			true,
		);
	});

	test("shows for any non-idle state even below the threshold", () => {
		assert.equal(shouldShowSelectionSheet(0, "counting"), true);
		assert.equal(shouldShowSelectionSheet(1, "running"), true);
		assert.equal(shouldShowSelectionSheet(0, "escalated"), true);
	});
});
