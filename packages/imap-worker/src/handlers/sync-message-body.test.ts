import assert from "node:assert";
import { describe, test } from "node:test";
import type { SyncedMessage } from "@remit/mailbox-service";
import type { SyncMessageBodyEvent } from "../events.js";
import { buildRetryEvent, resolveBatch } from "./sync-message-body.js";
import { BODY_BATCH_SIZE, batchSyncedMessages } from "./sync-messages.js";

const baseEvent = {
	type: "SYNC_MESSAGE_BODY" as const,
	accountId: "test-account-123",
	mailboxId: "test-mailbox-456",
	eventId: "event-789",
	timestamp: 1700000000000,
};

describe("resolveBatch — event-shape preference", () => {
	test("prefers the new messages[] shape and exposes the uid map", () => {
		const event: SyncMessageBodyEvent = {
			...baseEvent,
			messageIds: ["msg-1", "msg-2"],
			messages: [
				{ messageId: "msg-1", uid: 101 },
				{ messageId: "msg-2", uid: 102 },
			],
		};

		const { messageIds, uidByMessageId } = resolveBatch(event);

		assert.deepEqual(messageIds, ["msg-1", "msg-2"]);
		assert.ok(uidByMessageId);
		assert.equal(uidByMessageId.get("msg-1"), 101);
		assert.equal(uidByMessageId.get("msg-2"), 102);
	});

	test("derives messageIds from messages[] when both disagree", () => {
		// messages[] is authoritative; a stale messageIds list must not leak in.
		const event: SyncMessageBodyEvent = {
			...baseEvent,
			messageIds: ["stale"],
			messages: [{ messageId: "msg-1", uid: 101 }],
		};

		const { messageIds } = resolveBatch(event);

		assert.deepEqual(messageIds, ["msg-1"]);
	});

	test("falls back to legacy messageIds[] with no uid map", () => {
		const event: SyncMessageBodyEvent = {
			...baseEvent,
			messageIds: ["msg-1", "msg-2", "msg-3"],
		};

		const { messageIds, uidByMessageId } = resolveBatch(event);

		assert.deepEqual(messageIds, ["msg-1", "msg-2", "msg-3"]);
		assert.equal(uidByMessageId, undefined);
	});

	test("empty messages[] resolves to an empty batch, not the legacy list", () => {
		const event: SyncMessageBodyEvent = {
			...baseEvent,
			messageIds: ["should-be-ignored"],
			messages: [],
		};

		const { messageIds, uidByMessageId } = resolveBatch(event);

		assert.deepEqual(messageIds, []);
		assert.ok(uidByMessageId);
		assert.equal(uidByMessageId.size, 0);
	});
});

describe("buildRetryEvent — partial-failure re-enqueue", () => {
	const uidMap = new Map<string, number>([
		["msg-1", 101],
		["msg-2", 102],
		["msg-3", 103],
	]);

	test("re-enqueues ONLY the failed ids, never the whole batch", () => {
		const retry = buildRetryEvent(
			baseEvent.accountId,
			baseEvent.mailboxId,
			["msg-2"],
			uidMap,
		);

		assert.deepEqual(retry.messageIds, ["msg-2"]);
		assert.deepEqual(retry.messages, [{ messageId: "msg-2", uid: 102 }]);
	});

	test("carries forward uids for each failed id when known", () => {
		const retry = buildRetryEvent(
			baseEvent.accountId,
			baseEvent.mailboxId,
			["msg-1", "msg-3"],
			uidMap,
		);

		assert.deepEqual(retry.messages, [
			{ messageId: "msg-1", uid: 101 },
			{ messageId: "msg-3", uid: 103 },
		]);
	});

	test("legacy batch (no uid map) re-enqueues ids only", () => {
		const retry = buildRetryEvent(baseEvent.accountId, baseEvent.mailboxId, [
			"msg-2",
		]);

		assert.deepEqual(retry.messageIds, ["msg-2"]);
		assert.equal(retry.messages, undefined);
	});
});

describe("batchSyncedMessages — one batch == one ranged fetch", () => {
	const makeSynced = (count: number): SyncedMessage[] =>
		Array.from({ length: count }, (_, i) => ({
			messageId: `msg-${i}`,
			uid: i + 1,
		}));

	test("batch size is raised to 200", () => {
		assert.equal(BODY_BATCH_SIZE, 200);
	});

	test("packs up to 200 messages into a single batch", () => {
		const batches = batchSyncedMessages(makeSynced(200));

		assert.equal(batches.length, 1);
		assert.equal(batches[0].length, 200);
	});

	test("splits 201 messages into 200 + 1", () => {
		const batches = batchSyncedMessages(makeSynced(201));

		assert.equal(batches.length, 2);
		assert.equal(batches[0].length, 200);
		assert.equal(batches[1].length, 1);
	});

	test("keeps messageId+uid pairs intact per batch", () => {
		const batches = batchSyncedMessages(makeSynced(3));

		assert.deepEqual(batches[0], [
			{ messageId: "msg-0", uid: 1 },
			{ messageId: "msg-1", uid: 2 },
			{ messageId: "msg-2", uid: 3 },
		]);
	});

	test("empty input yields no batches", () => {
		assert.deepEqual(batchSyncedMessages([]), []);
	});
});
