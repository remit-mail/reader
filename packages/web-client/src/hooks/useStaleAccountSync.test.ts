import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	STALENESS_THRESHOLD_MS,
	selectStaleAccountIds,
} from "./useStaleAccountSync.js";

const NOW = 1_700_000_000_000;

describe("STALENESS_THRESHOLD_MS", () => {
	test("equals 15 minutes in milliseconds", () => {
		assert.equal(STALENESS_THRESHOLD_MS, 15 * 60 * 1000);
	});
});

describe("selectStaleAccountIds", () => {
	test("treats accounts with undefined lastSyncAt as stale", () => {
		const ids = selectStaleAccountIds(
			[{ accountId: "a-1", lastSyncAt: undefined }],
			NOW,
		);
		assert.deepEqual(ids, ["a-1"]);
	});

	test("treats accounts with null lastSyncAt as stale", () => {
		const ids = selectStaleAccountIds(
			// Real network responses can deserialize undefined as null in some
			// transports; cover both shapes.
			[{ accountId: "a-1", lastSyncAt: null as unknown as undefined }],
			NOW,
		);
		assert.deepEqual(ids, ["a-1"]);
	});

	test("returns the account when lastSyncAt is older than the threshold", () => {
		const ids = selectStaleAccountIds(
			[
				{
					accountId: "a-1",
					lastSyncAt: NOW - STALENESS_THRESHOLD_MS - 1000,
				},
			],
			NOW,
		);
		assert.deepEqual(ids, ["a-1"]);
	});

	test("does not return an account that synced inside the threshold", () => {
		const ids = selectStaleAccountIds(
			[{ accountId: "a-1", lastSyncAt: NOW - 60_000 }],
			NOW,
		);
		assert.deepEqual(ids, []);
	});

	test("returns only the stale accounts when mixed", () => {
		const ids = selectStaleAccountIds(
			[
				{ accountId: "fresh", lastSyncAt: NOW - 5 * 60_000 },
				{ accountId: "stale", lastSyncAt: NOW - 30 * 60_000 },
				{ accountId: "never", lastSyncAt: undefined },
			],
			NOW,
		);
		assert.deepEqual(ids, ["stale", "never"]);
	});

	test("respects an overridden threshold", () => {
		const ids = selectStaleAccountIds(
			[{ accountId: "a-1", lastSyncAt: NOW - 1500 }],
			NOW,
			1000,
		);
		assert.deepEqual(ids, ["a-1"]);
	});

	test("returns an empty list for an empty input", () => {
		assert.deepEqual(selectStaleAccountIds([], NOW), []);
	});

	test("equality on the threshold is treated as fresh", () => {
		// `now - lastSyncAt > thresholdMs` — strict greater-than means an
		// account synced exactly threshold ms ago is still fresh. Pinning
		// this so a future tweak to `>=` is a deliberate decision.
		const ids = selectStaleAccountIds(
			[{ accountId: "a-1", lastSyncAt: NOW - STALENESS_THRESHOLD_MS }],
			NOW,
		);
		assert.deepEqual(ids, []);
	});
});
