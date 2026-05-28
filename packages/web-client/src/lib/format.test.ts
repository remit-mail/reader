import assert from "node:assert";
import { describe, test } from "node:test";
import { formatDeleteToTrashTitle } from "./format.js";

describe("formatDeleteToTrashTitle", () => {
	test("uses the singular noun for one message", () => {
		assert.strictEqual(formatDeleteToTrashTitle(1), "Move 1 message to Trash?");
	});

	test("uses the plural noun and the count for many messages", () => {
		assert.strictEqual(
			formatDeleteToTrashTitle(3),
			"Move 3 messages to Trash?",
		);
	});

	test("treats zero as plural", () => {
		assert.strictEqual(
			formatDeleteToTrashTitle(0),
			"Move 0 messages to Trash?",
		);
	});
});
