import assert from "node:assert";
import { describe, test } from "node:test";
import {
	computeRange,
	intersectSelectedIds,
	nextFocusId,
} from "./useSelection.js";

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

describe("intersectSelectedIds", () => {
	test("a refresh that drops some selected ids and adds new rows keeps only the survivors (#111)", () => {
		// Regression for #111: the effect used to clear the WHOLE selection the
		// moment any single selected id left the list. Here "b" leaves (deleted
		// elsewhere) while "f" arrives (new mail) — "a" and "c" must survive.
		const selected = new Set(["a", "b", "c"]);
		const refreshedThreadIds = ["a", "c", "d", "f"];
		assert.deepStrictEqual(
			intersectSelectedIds(selected, refreshedThreadIds),
			new Set(["a", "c"]),
		);
	});

	test("never adds an id that wasn't already selected", () => {
		const selected = new Set(["a"]);
		assert.deepStrictEqual(
			intersectSelectedIds(selected, ["a", "b", "c"]),
			new Set(["a"]),
		);
	});

	test("every selected id surviving is a no-op (same members, not just same size)", () => {
		const selected = new Set(["a", "b"]);
		assert.deepStrictEqual(
			intersectSelectedIds(selected, ["a", "b", "z"]),
			new Set(["a", "b"]),
		);
	});

	test("a post-delete retry selection survives a refetch that still contains it, minus what actually left", () => {
		// Mirrors processDeleteOutcome materializing the failed ids as the new
		// selection, then the cache-invalidation refetch running this same
		// intersection against the freshly reloaded `threads`. One retry id
		// ("fail-2") is momentarily missing from the refreshed page; the other
		// two must stay selected so the Retry notice (gated on
		// `selectedCount > 0`) doesn't disappear with it.
		const retrySelection = new Set(["fail-1", "fail-2", "fail-3"]);
		const refetchedThreadIds = ["fail-1", "fail-3", "unrelated-1"];
		assert.deepStrictEqual(
			intersectSelectedIds(retrySelection, refetchedThreadIds),
			new Set(["fail-1", "fail-3"]),
		);
	});

	test("everything in the selection leaving empties it, rather than leaving stale ids behind", () => {
		const selected = new Set(["a", "b"]);
		assert.deepStrictEqual(intersectSelectedIds(selected, ["z"]), new Set());
	});

	test("an empty selection stays empty", () => {
		assert.deepStrictEqual(
			intersectSelectedIds(new Set(), ["a", "b"]),
			new Set(),
		);
	});
});
