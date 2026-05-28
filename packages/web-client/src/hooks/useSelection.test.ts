import assert from "node:assert";
import { describe, test } from "node:test";
import { computeRange, nextFocusId } from "./useSelection.js";

const ids = ["a", "b", "c", "d", "e"];

describe("computeRange", () => {
	test("forward range: anchor above target selects the inclusive slice", () => {
		assert.deepStrictEqual(computeRange(ids, "b", "d"), ["b", "c", "d"]);
	});

	test("backward range: target above anchor selects the same inclusive slice", () => {
		assert.deepStrictEqual(computeRange(ids, "d", "b"), ["b", "c", "d"]);
	});

	test("anchor equals target selects just that one id", () => {
		assert.deepStrictEqual(computeRange(ids, "c", "c"), ["c"]);
	});

	test("no anchor selects just the target", () => {
		assert.deepStrictEqual(computeRange(ids, undefined, "c"), ["c"]);
	});

	test("anchor not present in the list selects just the target", () => {
		assert.deepStrictEqual(computeRange(ids, "zzz", "c"), ["c"]);
	});

	test("full span from first to last includes every id in order", () => {
		assert.deepStrictEqual(computeRange(ids, "a", "e"), [
			"a",
			"b",
			"c",
			"d",
			"e",
		]);
	});

	test("target not present in the list selects nothing", () => {
		assert.deepStrictEqual(computeRange(ids, "b", "zzz"), []);
	});
});

describe("nextFocusId", () => {
	test("moves down one row", () => {
		assert.strictEqual(nextFocusId(ids, "b", 1), "c");
	});

	test("moves up one row", () => {
		assert.strictEqual(nextFocusId(ids, "c", -1), "b");
	});

	test("clamps at the bottom (no wrap)", () => {
		assert.strictEqual(nextFocusId(ids, "e", 1), "e");
	});

	test("clamps at the top (no wrap)", () => {
		assert.strictEqual(nextFocusId(ids, "a", -1), "a");
	});

	test("no focus + down starts at the first row", () => {
		assert.strictEqual(nextFocusId(ids, undefined, 1), "a");
	});

	test("no focus + up starts at the last row", () => {
		assert.strictEqual(nextFocusId(ids, undefined, -1), "e");
	});

	test("focus not in the list + down starts at the first row", () => {
		assert.strictEqual(nextFocusId(ids, "zzz", 1), "a");
	});

	test("empty list returns undefined", () => {
		assert.strictEqual(nextFocusId([], "a", 1), undefined);
	});
});
