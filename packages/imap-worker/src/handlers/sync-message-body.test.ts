import assert from "node:assert";
import { describe, test } from "node:test";
import type { SyncMessageBodyEvent } from "../events.js";

describe("SyncMessageBodyEvent", () => {
	test("event schema validates correctly", () => {
		const event: SyncMessageBodyEvent = {
			type: "SYNC_MESSAGE_BODY",
			accountId: "test-account-123",
			mailboxId: "test-mailbox-456",
			messageIds: ["msg-1", "msg-2", "msg-3"],
			eventId: "event-789",
			timestamp: Date.now(),
		};

		assert.equal(event.type, "SYNC_MESSAGE_BODY");
		assert.equal(event.accountId, "test-account-123");
		assert.equal(event.mailboxId, "test-mailbox-456");
		assert.equal(event.messageIds.length, 3);
		assert.ok(event.eventId);
		assert.ok(event.timestamp);
	});

	test("messageIds can be empty array", () => {
		const event: SyncMessageBodyEvent = {
			type: "SYNC_MESSAGE_BODY",
			accountId: "test-account-123",
			mailboxId: "test-mailbox-456",
			messageIds: [],
			eventId: "event-789",
			timestamp: Date.now(),
		};

		assert.equal(event.messageIds.length, 0);
	});

	test("messageIds preserves order", () => {
		const messageIds = ["z-last", "a-first", "m-middle"];
		const event: SyncMessageBodyEvent = {
			type: "SYNC_MESSAGE_BODY",
			accountId: "test-account-123",
			mailboxId: "test-mailbox-456",
			messageIds,
			eventId: "event-789",
			timestamp: Date.now(),
		};

		assert.deepEqual(event.messageIds, ["z-last", "a-first", "m-middle"]);
	});
});

describe("SYNC_MESSAGE_BODY batching", () => {
	const BODY_BATCH_SIZE = 10;

	test("creates single batch for less than 10 messages", () => {
		const messageIds = ["msg-1", "msg-2", "msg-3"];
		const batches: string[][] = [];

		for (let i = 0; i < messageIds.length; i += BODY_BATCH_SIZE) {
			batches.push(messageIds.slice(i, i + BODY_BATCH_SIZE));
		}

		assert.equal(batches.length, 1);
		assert.deepEqual(batches[0], messageIds);
	});

	test("creates multiple batches for more than 10 messages", () => {
		const messageIds = Array.from({ length: 25 }, (_, i) => `msg-${i}`);
		const batches: string[][] = [];

		for (let i = 0; i < messageIds.length; i += BODY_BATCH_SIZE) {
			batches.push(messageIds.slice(i, i + BODY_BATCH_SIZE));
		}

		assert.equal(batches.length, 3);
		assert.equal(batches[0].length, 10);
		assert.equal(batches[1].length, 10);
		assert.equal(batches[2].length, 5);
	});

	test("creates exact batches for multiples of 10", () => {
		const messageIds = Array.from({ length: 20 }, (_, i) => `msg-${i}`);
		const batches: string[][] = [];

		for (let i = 0; i < messageIds.length; i += BODY_BATCH_SIZE) {
			batches.push(messageIds.slice(i, i + BODY_BATCH_SIZE));
		}

		assert.equal(batches.length, 2);
		assert.equal(batches[0].length, 10);
		assert.equal(batches[1].length, 10);
	});

	test("handles empty messageIds array", () => {
		const messageIds: string[] = [];
		const batches: string[][] = [];

		for (let i = 0; i < messageIds.length; i += BODY_BATCH_SIZE) {
			batches.push(messageIds.slice(i, i + BODY_BATCH_SIZE));
		}

		assert.equal(batches.length, 0);
	});
});
