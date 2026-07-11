import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createIndexWorkStats } from "./index-stats.js";

describe("createIndexWorkStats", () => {
	test("counts an upserted:0 indexed outcome as noop (the over-trigger signal)", () => {
		const stats = createIndexWorkStats();
		stats.record({ status: "indexed", upserted: 0, skipped: 4 }, false);
		stats.record({ status: "indexed", upserted: 2, skipped: 1 }, false);
		assert.deepStrictEqual(stats.drain(), {
			processed: 2,
			embedded: 1,
			noop: 1,
			deferred: 0,
			dropped: 0,
			forced: 0,
		});
	});

	test("separates transient (deferred) from terminal (dropped) skips", () => {
		const stats = createIndexWorkStats();
		stats.record(
			{ status: "skipped", reason: "parsed-body-not-found", retryable: true },
			false,
		);
		stats.record(
			{ status: "skipped", reason: "no-indexable-content", retryable: false },
			false,
		);
		assert.deepStrictEqual(stats.drain(), {
			processed: 2,
			embedded: 0,
			noop: 0,
			deferred: 1,
			dropped: 1,
			forced: 0,
		});
	});

	test("counts force re-indexes (moves) separately", () => {
		const stats = createIndexWorkStats();
		stats.record({ status: "indexed", upserted: 3, skipped: 0 }, true);
		stats.record({ status: "indexed", upserted: 1, skipped: 0 }, false);
		const summary = stats.drain();
		assert.equal(summary?.forced, 1);
		assert.equal(summary?.processed, 2);
	});

	test("drain resets the window and returns null when empty", () => {
		const stats = createIndexWorkStats();
		assert.equal(stats.drain(), null, "nothing recorded yet");
		stats.record({ status: "indexed", upserted: 1, skipped: 0 }, false);
		assert.ok(stats.drain());
		assert.equal(stats.drain(), null, "drained window is empty again");
	});
});
