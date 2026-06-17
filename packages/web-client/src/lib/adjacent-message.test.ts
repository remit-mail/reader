import assert from "node:assert";
import { describe, test } from "node:test";
import { adjacentMessageId } from "./adjacent-message.js";

describe("adjacentMessageId", () => {
	const ids = ["a", "b", "c"];

	test("next returns the following id", () => {
		assert.strictEqual(adjacentMessageId(ids, "a", "next"), "b");
		assert.strictEqual(adjacentMessageId(ids, "b", "next"), "c");
	});

	test("previous returns the preceding id", () => {
		assert.strictEqual(adjacentMessageId(ids, "c", "previous"), "b");
		assert.strictEqual(adjacentMessageId(ids, "b", "previous"), "a");
	});

	test("returns null at the end of the list (no wrap)", () => {
		assert.strictEqual(adjacentMessageId(ids, "c", "next"), null);
	});

	test("returns null at the start of the list (no wrap)", () => {
		assert.strictEqual(adjacentMessageId(ids, "a", "previous"), null);
	});

	test("returns null when current id is not in the list", () => {
		assert.strictEqual(adjacentMessageId(ids, "z", "next"), null);
		assert.strictEqual(adjacentMessageId(ids, "z", "previous"), null);
	});

	test("returns null when there is no current id", () => {
		assert.strictEqual(adjacentMessageId(ids, undefined, "next"), null);
	});

	test("returns null for a single-item list at both ends", () => {
		assert.strictEqual(adjacentMessageId(["only"], "only", "next"), null);
		assert.strictEqual(adjacentMessageId(["only"], "only", "previous"), null);
	});

	test("returns null for an empty list", () => {
		assert.strictEqual(adjacentMessageId([], "a", "next"), null);
	});
});
