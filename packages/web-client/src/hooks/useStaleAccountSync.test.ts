import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { ApiError } from "../lib/api.js";
import { __resetFatalError, subscribeFatalError } from "../lib/fatal-error.js";
import {
	__peekStaleAccountSyncGuard,
	__resetStaleAccountSyncGuard,
	handleBackgroundSyncFailure,
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

describe("handleBackgroundSyncFailure", () => {
	afterEach(() => {
		__resetFatalError();
		__resetStaleAccountSyncGuard();
		console.warn = originalWarn;
	});

	const originalWarn = console.warn;
	const silenceWarn = () => {
		console.warn = () => undefined;
	};

	test("a background-sync 5xx escalates to the fatal overlay", () => {
		silenceWarn();
		const seen: string[] = [];
		subscribeFatalError((fatal) => seen.push(fatal.message));

		handleBackgroundSyncFailure("a-1", new ApiError("boom", 503));

		// Fail-fast contract (#1059, rule 2): a 5xx is OUR API broken and always
		// escalates — even from a best-effort background probe. (This reverses the
		// #758 swallow, which let a real 500 vanish silently.)
		assert.deepEqual(seen, ["boom"]);
	});

	test("a background-sync 4xx (the account's own problem) does NOT escalate", () => {
		silenceWarn();
		let escalated = false;
		subscribeFatalError(() => {
			escalated = true;
		});

		handleBackgroundSyncFailure("a-1", new ApiError("forbidden", 403));

		// Non-5xx stays soft — the call site owns it (the Settings "Refresh
		// mailboxes" button is the surfaced path).
		assert.equal(escalated, false);
	});

	test("a network blip on the background probe does NOT escalate", () => {
		silenceWarn();
		let escalated = false;
		subscribeFatalError(() => {
			escalated = true;
		});

		handleBackgroundSyncFailure("a-1", new TypeError("Failed to fetch"));

		assert.equal(escalated, false);
	});

	test("drops the per-account guard so a later remount can retry", () => {
		silenceWarn();
		__peekStaleAccountSyncGuard(); // touch to ensure import is used
		handleBackgroundSyncFailure("a-1", new ApiError("boom", 503));

		assert.equal(__peekStaleAccountSyncGuard().has("a-1"), false);
	});
});
