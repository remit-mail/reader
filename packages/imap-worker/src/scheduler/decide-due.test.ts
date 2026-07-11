import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSyncDue } from "./decide-due.js";

const OFFLINE_INTERVAL_MS = 12 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

describe("isSyncDue", () => {
	it("is always due when the account has never synced", () => {
		assert.equal(isSyncDue({ accountId: "a" }, NOW, OFFLINE_INTERVAL_MS), true);
	});

	it("is due once the sync is older than the offline interval", () => {
		const account = {
			accountId: "a",
			lastSyncAt: NOW - OFFLINE_INTERVAL_MS - 1,
		};
		assert.equal(isSyncDue(account, NOW, OFFLINE_INTERVAL_MS), true);
	});

	it("is not due within the offline interval", () => {
		const account = {
			accountId: "a",
			lastSyncAt: NOW - 60_000,
		};
		assert.equal(isSyncDue(account, NOW, OFFLINE_INTERVAL_MS), false);
	});

	it("is due exactly at the threshold", () => {
		const account = {
			accountId: "a",
			lastSyncAt: NOW - OFFLINE_INTERVAL_MS,
		};
		assert.equal(isSyncDue(account, NOW, OFFLINE_INTERVAL_MS), true);
	});

	it("is not due one millisecond before the threshold", () => {
		const account = {
			accountId: "a",
			lastSyncAt: NOW - OFFLINE_INTERVAL_MS + 1,
		};
		assert.equal(isSyncDue(account, NOW, OFFLINE_INTERVAL_MS), false);
	});
});
