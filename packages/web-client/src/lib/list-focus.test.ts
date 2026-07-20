import assert from "node:assert";
import { describe, test } from "node:test";
import { tabStopId } from "./list-focus.ts";

const ids = ["a", "b", "c"];

describe("tabStopId", () => {
	test("the cursor row holds the tab stop", () => {
		assert.strictEqual(tabStopId(ids, "b"), "b");
	});

	test("an untouched list puts the tab stop on the first row", () => {
		assert.strictEqual(tabStopId(ids, undefined), "a");
	});

	test("a cursor that no longer exists falls back to the first row", () => {
		// After a delete or a refetch the cursor can name a row that is gone; the
		// list must keep a tab stop or Tab skips over it entirely.
		assert.strictEqual(tabStopId(ids, "zzz"), "a");
	});

	test("an empty list has no tab stop", () => {
		assert.strictEqual(tabStopId([], "a"), undefined);
	});
});
