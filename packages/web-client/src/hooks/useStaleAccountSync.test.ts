import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { ApiError } from "../lib/api.js";
import { __resetFatalError, subscribeFatalError } from "../lib/fatal-error.js";
import {
	__peekStaleAccountSyncGuard,
	__resetStaleAccountSyncGuard,
	handleBackgroundSyncFailure,
	hasPollIntervalElapsed,
	MIN_POLL_INTERVAL_MS,
	POLL_INTERVAL_MS,
	resolvePollIntervalMs,
	STALENESS_THRESHOLD_MS,
	selectPollableAccountIds,
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

describe("POLL_INTERVAL_MS", () => {
	test("defaults to 5 minutes when mailboxPollIntervalSeconds is unset in this test run", () => {
		assert.equal(POLL_INTERVAL_MS, 5 * 60 * 1000);
	});
});

describe("resolvePollIntervalMs", () => {
	// This poll shares POST /sync with the refresh control, and that endpoint's
	// triggers skip the server's per-mailbox freshness gate
	// (MAILBOX_FRESHNESS_MS in imap-worker's sync-mailboxes fan-out). A timer is
	// not a person: without this floor, configuring a sub-window interval turns
	// every tick into a full folder-by-folder re-enumeration for every open
	// account, which is exactly the fan-out storm the gate prevents. The floor
	// is what stops a config value from reintroducing it.
	test("never returns less than the server's freshness window", () => {
		assert.equal(resolvePollIntervalMs("10"), MIN_POLL_INTERVAL_MS);
		assert.equal(resolvePollIntervalMs("59"), MIN_POLL_INTERVAL_MS);
	});

	test("matches the freshness window the fan-out gate uses", () => {
		// Keep in step with MAILBOX_FRESHNESS_MS in
		// packages/imap-worker/src/handlers/sync-mailboxes.ts.
		assert.equal(MIN_POLL_INTERVAL_MS, 60_000);
	});

	test("honours a configured interval above the floor", () => {
		assert.equal(resolvePollIntervalMs("900"), 900_000);
	});

	test("falls back to the default when unset or unparseable", () => {
		assert.equal(resolvePollIntervalMs(undefined), 5 * 60 * 1000);
		assert.equal(resolvePollIntervalMs("not-a-number"), 5 * 60 * 1000);
	});
});

describe("hasPollIntervalElapsed", () => {
	test("is false immediately after a poll", () => {
		assert.equal(hasPollIntervalElapsed(NOW, NOW, 60_000), false);
	});

	test("is false before a full interval has elapsed", () => {
		assert.equal(hasPollIntervalElapsed(NOW, NOW - 59_000, 60_000), false);
	});

	test("is true exactly at the interval boundary", () => {
		assert.equal(hasPollIntervalElapsed(NOW, NOW - 60_000, 60_000), true);
	});

	test("is true once the interval has passed", () => {
		assert.equal(hasPollIntervalElapsed(NOW, NOW - 61_000, 60_000), true);
	});

	test("defaults to POLL_INTERVAL_MS when no interval is passed", () => {
		assert.equal(hasPollIntervalElapsed(NOW, NOW - POLL_INTERVAL_MS - 1), true);
		assert.equal(
			hasPollIntervalElapsed(NOW, NOW - POLL_INTERVAL_MS + 1),
			false,
		);
	});
});

describe("selectPollableAccountIds", () => {
	test("returns every accountId when nothing is in flight", () => {
		const ids = selectPollableAccountIds(["a-1", "a-2"], new Set());
		assert.deepEqual(ids, ["a-1", "a-2"]);
	});

	test("drops an accountId already in flight (no stacked requests)", () => {
		const ids = selectPollableAccountIds(["a-1", "a-2"], new Set(["a-1"]));
		assert.deepEqual(ids, ["a-2"]);
	});

	test("returns an empty list when every account is in flight", () => {
		const ids = selectPollableAccountIds(
			["a-1", "a-2"],
			new Set(["a-1", "a-2"]),
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
