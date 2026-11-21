import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isStale } from "./freshness.js";

const WINDOW_MS = 60_000;
const NOW = 1_700_000_000_000;

describe("isStale", () => {
	it("is stale when the work was never done", () => {
		assert.equal(isStale(undefined, NOW, WINDOW_MS), true);
		assert.equal(isStale(0, NOW, WINDOW_MS), true);
	});

	it("is stale exactly at the window", () => {
		assert.equal(isStale(NOW - WINDOW_MS, NOW, WINDOW_MS), true);
	});

	it("is fresh one millisecond inside the window", () => {
		assert.equal(isStale(NOW - WINDOW_MS + 1, NOW, WINDOW_MS), false);
	});
});
