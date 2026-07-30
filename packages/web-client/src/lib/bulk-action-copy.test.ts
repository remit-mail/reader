import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	type BulkActionKind,
	bulkActionCompletionText,
	bulkActionFailureDetail,
	bulkActionFailureTitle,
	bulkActionProgressLabel,
	bulkActionProgressTone,
	bulkActionStoppedDetail,
	bulkActionStoppedTitle,
} from "./bulk-action-copy.js";

const kinds: BulkActionKind[] = ["delete", "move", "markRead"];

describe("bulkActionProgressLabel", () => {
	test("names the action and both counts", () => {
		assert.equal(
			bulkActionProgressLabel("delete", 1200, 3412),
			"Deleting 1,200 of 3,412…",
		);
		assert.equal(
			bulkActionProgressLabel("move", 1200, 3412),
			"Moving 1,200 of 3,412…",
		);
		assert.equal(
			bulkActionProgressLabel("markRead", 1200, 3412),
			"Marking 1,200 of 3,412 as read…",
		);
	});
});

describe("bulkActionCompletionText", () => {
	test("says what happened and that the server is still applying it", () => {
		assert.equal(
			bulkActionCompletionText("delete", 3412),
			"3,412 moved to Trash. Your mail server is still catching up.",
		);
		assert.equal(
			bulkActionCompletionText("move", 3412),
			"3,412 moved. Your mail server is still catching up.",
		);
		assert.equal(
			bulkActionCompletionText("markRead", 3412),
			"3,412 marked as read. Your mail server is still catching up.",
		);
	});
});

describe("bulkActionFailureTitle", () => {
	test("reports where a partly-done run stopped", () => {
		assert.equal(
			bulkActionFailureTitle("move", 3072),
			"Stopped after 3,072 — some messages couldn't be moved",
		);
	});

	test("drops the count when nothing landed", () => {
		assert.equal(
			bulkActionFailureTitle("markRead", 0),
			"Couldn't mark these messages as read",
		);
		assert.equal(
			bulkActionFailureTitle("delete", 0),
			"Couldn't delete these messages",
		);
	});
});

describe("a run that stopped short of its match", () => {
	test("states what it reached and that the rest is untouched", () => {
		assert.equal(bulkActionStoppedTitle(1200), "Stopped after 1,200");
		assert.equal(
			bulkActionStoppedDetail("delete", 1200, 3412),
			"1,200 of 3,412 moved to Trash. Nothing was sent for the rest, so they are untouched.",
		);
		assert.equal(
			bulkActionStoppedDetail("markRead", 1200, 3412),
			"1,200 of 3,412 marked as read. Nothing was sent for the rest, so they are untouched.",
		);
	});

	test("never reads as a rejection — nothing was sent", () => {
		assert.doesNotMatch(
			bulkActionStoppedDetail("move", 1, 2),
			/rejected|couldn't/i,
		);
	});
});

describe("every action carries its own wording", () => {
	test("no two actions share a sentence", () => {
		const sentences: Array<(kind: BulkActionKind) => string> = [
			(kind) => bulkActionCompletionText(kind, 5),
			(kind) => bulkActionFailureTitle(kind, 0),
			(kind) => bulkActionFailureTitle(kind, 5),
			bulkActionFailureDetail,
			(kind) => bulkActionProgressLabel(kind, 1, 2),
			(kind) => bulkActionStoppedDetail(kind, 1, 2),
		];
		for (const render of sentences) {
			assert.equal(new Set(kinds.map(render)).size, kinds.length);
		}
	});
});

describe("bulkActionProgressTone", () => {
	test("only delete reads as destructive", () => {
		assert.equal(bulkActionProgressTone("delete"), "danger");
		assert.equal(bulkActionProgressTone("move"), "info");
		assert.equal(bulkActionProgressTone("markRead"), "info");
	});
});
