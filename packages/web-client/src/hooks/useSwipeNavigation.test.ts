import assert from "node:assert";
import { describe, test } from "node:test";
import { resolveSwipe } from "./useSwipeNavigation.js";

const THRESHOLD = 60;

describe("resolveSwipe", () => {
	test("classifies a left swipe (next) when dragging right→left", () => {
		assert.strictEqual(resolveSwipe(-80, 0, THRESHOLD).direction, "left");
	});

	test("classifies a right swipe (previous) when dragging left→right", () => {
		assert.strictEqual(resolveSwipe(80, 0, THRESHOLD).direction, "right");
	});

	test("ignores a gesture shorter than the threshold", () => {
		assert.strictEqual(resolveSwipe(-40, 0, THRESHOLD).direction, null);
		assert.strictEqual(resolveSwipe(59, 0, THRESHOLD).direction, null);
	});

	test("ignores a mostly-vertical gesture so it never hijacks scroll", () => {
		// Long horizontal travel but even longer vertical travel: this is a scroll.
		assert.strictEqual(resolveSwipe(70, 200, THRESHOLD).direction, null);
		assert.strictEqual(resolveSwipe(-70, -200, THRESHOLD).direction, null);
	});

	test("accepts a horizontal swipe with mild vertical drift", () => {
		assert.strictEqual(resolveSwipe(-100, 20, THRESHOLD).direction, "left");
	});

	test("rejects a diagonal gesture that is not horizontally dominant", () => {
		// dx 70, dy 60: not 1.5x dominant, so treated as ambiguous → no swipe.
		assert.strictEqual(resolveSwipe(70, 60, THRESHOLD).direction, null);
	});
});
