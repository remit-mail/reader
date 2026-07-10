import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getOfflineIntervalMs, getOnlineIntervalMs } from "./config.js";

describe("getOnlineIntervalMs", () => {
	it("defaults to 5 minutes when unset", () => {
		assert.equal(getOnlineIntervalMs({}), 5 * 60 * 1000);
	});

	it("reads MAILBOX_SYNC_ONLINE_INTERVAL_SECONDS", () => {
		assert.equal(
			getOnlineIntervalMs({ MAILBOX_SYNC_ONLINE_INTERVAL_SECONDS: "60" }),
			60_000,
		);
	});

	it("falls back to the default on a non-positive or non-numeric value", () => {
		assert.equal(
			getOnlineIntervalMs({ MAILBOX_SYNC_ONLINE_INTERVAL_SECONDS: "0" }),
			5 * 60 * 1000,
		);
		assert.equal(
			getOnlineIntervalMs({ MAILBOX_SYNC_ONLINE_INTERVAL_SECONDS: "nope" }),
			5 * 60 * 1000,
		);
	});
});

describe("getOfflineIntervalMs", () => {
	it("defaults to 12 hours when unset", () => {
		assert.equal(getOfflineIntervalMs({}), 12 * 60 * 60 * 1000);
	});

	it("reads MAILBOX_SYNC_OFFLINE_INTERVAL_SECONDS", () => {
		assert.equal(
			getOfflineIntervalMs({ MAILBOX_SYNC_OFFLINE_INTERVAL_SECONDS: "3600" }),
			3_600_000,
		);
	});
});
