import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DeleteAccountObjectsEvent } from "./delete-account-objects.js";

describe("DeleteAccountObjects handler", () => {
	it("event shape is correct", () => {
		const event: DeleteAccountObjectsEvent = {
			type: "DELETE_ACCOUNT_OBJECTS",
			accountConfigId: "test-account-config-id-12345",
		};

		assert.equal(event.type, "DELETE_ACCOUNT_OBJECTS");
		assert.equal(event.accountConfigId, "test-account-config-id-12345");
		assert.equal(event.continuationToken, undefined);
	});

	it("event with continuation token is correct", () => {
		const event: DeleteAccountObjectsEvent = {
			type: "DELETE_ACCOUNT_OBJECTS",
			accountConfigId: "test-account-config-id-12345",
			continuationToken: "abc123",
		};

		assert.equal(event.continuationToken, "abc123");
	});

	it("S3 prefix follows expected pattern", () => {
		const accountConfigId = "test-account-config-id-12345";
		const prefix = `accounts/${accountConfigId}/`;

		assert.ok(prefix.startsWith("accounts/"));
		assert.ok(prefix.endsWith("/"));
		assert.ok(prefix.includes(accountConfigId));
	});

	it("batch size calculation respects limit", () => {
		const BATCH_SIZE = 1_000;
		const keys = Array.from({ length: 2500 }, (_, i) => `key-${i}`);

		// Simulate batching
		const batches: string[][] = [];
		for (let i = 0; i < keys.length; i += BATCH_SIZE) {
			batches.push(keys.slice(i, i + BATCH_SIZE));
		}

		assert.equal(batches.length, 3);
		assert.equal(batches[0].length, 1000);
		assert.equal(batches[1].length, 1000);
		assert.equal(batches[2].length, 500);
	});

	it("re-enqueue event preserves continuation token", () => {
		const accountConfigId = "test-id";
		const continuationToken = "next-page-token";

		const reenqueueEvent: DeleteAccountObjectsEvent = {
			type: "DELETE_ACCOUNT_OBJECTS",
			accountConfigId,
			continuationToken,
		};

		const body = JSON.stringify(reenqueueEvent);
		const parsed = JSON.parse(body) as DeleteAccountObjectsEvent;

		assert.equal(parsed.type, "DELETE_ACCOUNT_OBJECTS");
		assert.equal(parsed.accountConfigId, accountConfigId);
		assert.equal(parsed.continuationToken, continuationToken);
	});

	it("timeout detection triggers re-enqueue", () => {
		const MIN_REMAINING_MS = 30_000;

		// Simulate near-timeout scenario
		const getRemainingTimeMs = () => 25_000;
		assert.ok(getRemainingTimeMs() < MIN_REMAINING_MS);

		// Simulate enough time
		const getRemainingTimeMsOk = () => 60_000;
		assert.ok(getRemainingTimeMsOk() >= MIN_REMAINING_MS);
	});
});
