import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getOfflineIntervalMs, getTickIntervalMs } from "./config.js";

describe("getTickIntervalMs", () => {
	it("defaults to 1 hour when unset", () => {
		assert.equal(getTickIntervalMs({}), 60 * 60 * 1000);
	});

	it("reads MAILBOX_SYNC_TICK_INTERVAL_SECONDS", () => {
		assert.equal(
			getTickIntervalMs({ MAILBOX_SYNC_TICK_INTERVAL_SECONDS: "60" }),
			60_000,
		);
	});

	it("falls back to the default on a non-positive or non-numeric value", () => {
		assert.equal(
			getTickIntervalMs({ MAILBOX_SYNC_TICK_INTERVAL_SECONDS: "0" }),
			60 * 60 * 1000,
		);
		assert.equal(
			getTickIntervalMs({ MAILBOX_SYNC_TICK_INTERVAL_SECONDS: "nope" }),
			60 * 60 * 1000,
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
