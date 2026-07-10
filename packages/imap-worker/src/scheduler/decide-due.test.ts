import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DUE_SLACK_MS, isAccountOnline, isSyncDue } from "./decide-due.js";

const ONLINE_INTERVAL_MS = 5 * 60 * 1000;
const OFFLINE_INTERVAL_MS = 12 * 60 * 60 * 1000;
const THRESHOLDS = {
	onlineIntervalMs: ONLINE_INTERVAL_MS,
	offlineIntervalMs: OFFLINE_INTERVAL_MS,
};
const NOW = 1_700_000_000_000;

describe("isAccountOnline", () => {
	it("is false when the account has never had recorded activity", () => {
		assert.equal(
			isAccountOnline({ accountId: "a" }, NOW, ONLINE_INTERVAL_MS),
			false,
		);
	});

	it("is true when activity was recorded within the online interval", () => {
		const account = { accountId: "a", lastActivityAt: NOW - 60_000 };
		assert.equal(isAccountOnline(account, NOW, ONLINE_INTERVAL_MS), true);
	});

	it("is true exactly at the online interval boundary", () => {
		const account = {
			accountId: "a",
			lastActivityAt: NOW - ONLINE_INTERVAL_MS,
		};
		assert.equal(isAccountOnline(account, NOW, ONLINE_INTERVAL_MS), true);
	});

	it("is false once activity is older than the online interval", () => {
		const account = {
			accountId: "a",
			lastActivityAt: NOW - ONLINE_INTERVAL_MS - 1,
		};
		assert.equal(isAccountOnline(account, NOW, ONLINE_INTERVAL_MS), false);
	});
});

describe("isSyncDue", () => {
	it("is always due when the account has never synced", () => {
		assert.equal(isSyncDue({ accountId: "a" }, NOW, THRESHOLDS), true);
	});

	it("online account: due once the sync is older than the online interval", () => {
		const account = {
			accountId: "a",
			lastActivityAt: NOW - 1_000,
			lastSyncAt: NOW - ONLINE_INTERVAL_MS - 1,
		};
		assert.equal(isSyncDue(account, NOW, THRESHOLDS), true);
	});

	it("online account: not due when the sync is fresh within the online interval", () => {
		const account = {
			accountId: "a",
			lastActivityAt: NOW - 1_000,
			lastSyncAt: NOW - 60_000,
		};
		assert.equal(isSyncDue(account, NOW, THRESHOLDS), false);
	});

	it("offline account: NOT due even though the sync is older than the online interval", () => {
		const account = {
			accountId: "a",
			// no lastActivityAt => offline
			lastSyncAt: NOW - ONLINE_INTERVAL_MS - 1,
		};
		assert.equal(isSyncDue(account, NOW, THRESHOLDS), false);
	});

	it("offline account: due once the sync is older than the offline interval", () => {
		const account = {
			accountId: "a",
			lastSyncAt: NOW - OFFLINE_INTERVAL_MS - 1,
		};
		assert.equal(isSyncDue(account, NOW, THRESHOLDS), true);
	});

	it("offline account: not due within the offline interval", () => {
		const account = {
			accountId: "a",
			lastSyncAt: NOW - OFFLINE_INTERVAL_MS + 2 * DUE_SLACK_MS,
		};
		assert.equal(isSyncDue(account, NOW, THRESHOLDS), false);
	});

	describe("DUE_SLACK_MS cadence fix (review #1250)", () => {
		it("online: due at the tick immediately after the one that enqueued it, even though lastSyncAt was stamped a few seconds late", () => {
			// Reproduces the reported bug exactly: a tick fires every
			// ONLINE_INTERVAL_MS; the worker stamps lastSyncAt ~3s after the
			// tick that triggered the sync. The very next tick, one full
			// interval later, must still see the account as due.
			const account = {
				accountId: "a",
				lastActivityAt: NOW - 1_000,
				lastSyncAt: NOW - (ONLINE_INTERVAL_MS - 3_000),
			};
			assert.equal(isSyncDue(account, NOW, THRESHOLDS), true);
		});

		it("online: not due immediately after a fresh sync (no runaway re-enqueue within one tick)", () => {
			const account = {
				accountId: "a",
				lastActivityAt: NOW - 1_000,
				lastSyncAt: NOW - 3_000,
			};
			assert.equal(isSyncDue(account, NOW, THRESHOLDS), false);
		});

		it("online: due exactly at the slack-adjusted threshold", () => {
			const account = {
				accountId: "a",
				lastActivityAt: NOW - 1_000,
				lastSyncAt: NOW - (ONLINE_INTERVAL_MS - DUE_SLACK_MS),
			};
			assert.equal(isSyncDue(account, NOW, THRESHOLDS), true);
		});

		it("online: not due one millisecond before the slack-adjusted threshold", () => {
			const account = {
				accountId: "a",
				lastActivityAt: NOW - 1_000,
				lastSyncAt: NOW - (ONLINE_INTERVAL_MS - DUE_SLACK_MS - 1),
			};
			assert.equal(isSyncDue(account, NOW, THRESHOLDS), false);
		});
	});
});
