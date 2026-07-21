import assert from "node:assert";
import { describe, test } from "node:test";
import {
	computeRange,
	intersectSelectedIds,
	nextFocusId,
	resolveRangeAnchor,
} from "./useSelection.js";

const ids = ["a", "b", "c", "d", "e"];

// Mirrors the hook's `selectRange` state transition (anchor + selection) using
// the same pure helpers it runs, so the mouse/keyboard sequences below exercise
// the real logic without an interactive DOM. Returns the next {selected, anchor}.
const applyRange = (
	state: { selected: Set<string>; anchor: string | undefined },
	orderedIds: string[],
	targetId: string,
	fallbackAnchor?: string,
): { selected: Set<string>; anchor: string | undefined } => {
	const anchor = resolveRangeAnchor(
		orderedIds,
		state.anchor,
		fallbackAnchor,
		targetId,
	);
	const range = computeRange(orderedIds, anchor, targetId);
	const selected = new Set(state.selected);
	for (const id of range) selected.add(id);
	return { selected, anchor };
};

// Mirrors a cmd/ctrl-click: toggle membership and re-anchor on the clicked row.
const applyToggle = (
	state: { selected: Set<string>; anchor: string | undefined },
	targetId: string,
): { selected: Set<string>; anchor: string | undefined } => {
	const selected = new Set(state.selected);
	if (selected.has(targetId)) selected.delete(targetId);
	else selected.add(targetId);
	return { selected, anchor: targetId };
};

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

describe("resolveRangeAnchor", () => {
	test("keeps a still-visible stored anchor so consecutive shift-clicks extend from it", () => {
		assert.strictEqual(resolveRangeAnchor(ids, "b", undefined, "d"), "b");
	});

	test("a stored anchor no longer visible falls back to the open/focused row", () => {
		// The stored anchor "z" was filtered/searched out of the visible list; the
		// open row "b" is still visible, so the range anchors there.
		assert.strictEqual(resolveRangeAnchor(ids, "z", "b", "d"), "b");
	});

	test("with neither a visible stored anchor nor a visible fallback, the target anchors itself", () => {
		assert.strictEqual(resolveRangeAnchor(ids, "z", "y", "d"), "d");
	});

	test("no stored anchor and no fallback selects just the target", () => {
		assert.strictEqual(resolveRangeAnchor(ids, undefined, undefined, "c"), "c");
	});

	test("a stored anchor beats the fallback while it stays visible", () => {
		assert.strictEqual(resolveRangeAnchor(ids, "a", "c", "e"), "a");
	});
});

describe("shift-click range over a filtered/search-narrowed list (#142, #144)", () => {
	test("shift-click range with an active filter builds the range within the visible rows", () => {
		// Full inbox is a..h; the "Automated" filter leaves only these rows.
		const filtered = ["b", "d", "f", "g"];
		// The open row "d" is visible; nothing selected yet, no stored anchor.
		let state = {
			selected: new Set<string>(),
			anchor: undefined as string | undefined,
		};
		// Shift-click "g": ranges from the open/focused row "d" to "g".
		state = applyRange(state, filtered, "g", "d");
		assert.deepStrictEqual([...state.selected], ["d", "f", "g"]);
		assert.strictEqual(state.anchor, "d");
	});

	test("range where the anchor left the visible set re-anchors instead of no-oping", () => {
		const filtered = ["b", "d", "f", "g"];
		// Stored anchor "a" was selected before the filter narrowed the list and is
		// no longer visible; there is no open/focused fallback row.
		let state = {
			selected: new Set<string>(),
			anchor: "a" as string | undefined,
		};
		// First shift-click adopts the clicked row as the new visible anchor.
		state = applyRange(state, filtered, "f");
		assert.deepStrictEqual([...state.selected], ["f"]);
		assert.strictEqual(state.anchor, "f");
		// Second shift-click now builds a real range from that adopted anchor.
		state = applyRange(state, filtered, "b");
		assert.deepStrictEqual([...state.selected].sort(), ["b", "d", "f"]);
		assert.strictEqual(state.anchor, "f");
	});

	test("multi-select across a search-results list: cmd-click then shift-click", () => {
		// Search "npm" yields these results; the inbox anchor is gone from this set.
		const results = ["m1", "m2", "m3", "m4", "m5"];
		let state = {
			selected: new Set<string>(),
			anchor: "inbox-row" as string | undefined,
		};
		// Cmd-click "m2": toggles it in and re-anchors on it (a visible row).
		state = applyToggle(state, "m2");
		assert.deepStrictEqual([...state.selected], ["m2"]);
		assert.strictEqual(state.anchor, "m2");
		// Shift-click "m4": ranges from the cmd-clicked anchor across the results.
		state = applyRange(state, results, "m4");
		assert.deepStrictEqual([...state.selected].sort(), ["m2", "m3", "m4"]);
		assert.strictEqual(state.anchor, "m2");
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
