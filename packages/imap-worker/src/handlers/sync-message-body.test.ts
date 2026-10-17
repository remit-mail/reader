import assert from "node:assert";
import { describe, test } from "node:test";
import type { Logger } from "@remit/logger-lambda";
import type { SyncedMessage } from "@remit/mailbox-service";
import type { SyncMessageBodyEvent } from "../events.js";
import {
	buildRetryableFailureError,
	resolveBatch,
} from "./sync-message-body.js";
import { batchSyncedMessages } from "./sync-messages.js";

const _silentLogger = (() => {
	const noop = () => {};
	const log = {
		info: noop,
		warn: noop,
		error: noop,
		debug: noop,
		fatal: noop,
		trace: noop,
		child: () => log,
	} as unknown as Logger;
	return log;
})();

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

	test("force defaults to false when the event omits it (legacy/bulk events)", () => {
		const event: SyncMessageBodyEvent = {
			...baseEvent,
			messageIds: ["msg-1"],
		};

		assert.equal(resolveBatch(event).force, false);
	});

	test("force is carried from the event's read-miss re-arm cue", () => {
		const event: SyncMessageBodyEvent = {
			...baseEvent,
			messageIds: ["msg-1"],
			messages: [{ messageId: "msg-1", uid: 101 }],
			force: true,
		};

		assert.equal(resolveBatch(event).force, true);
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

describe("buildRetryableFailureError — the DLQ-propagation signal", () => {
	// Genuine processing failures must propagate (issue #1270): syncMessageBody
	// throws this while SQS redelivery budget remains, instead of swallowing the
	// failure into a fresh re-enqueue. index.ts's SQS handler catches it and
	// reports the record as a batch item failure, so SQS redelivers it — and
	// once the queue's own maxReceiveCount is hit, the record dead-letters into
	// the body-dlq (alarmed in infra/stacks/dev/stacks/remit-worker-monitoring-stack.ts).

	test("names every failed message id and the current attempt", () => {
		const error = buildRetryableFailureError(["msg-1", "msg-2"], 1);

		assert.match(error.message, /msg-1/);
		assert.match(error.message, /msg-2/);
		assert.match(error.message, /attempt 1\/3/);
	});
});

describe("batchSyncedMessages — one batch == one ranged fetch", () => {
	const makeSynced = (count: number): SyncedMessage[] =>
		Array.from({ length: count }, (_, i) => ({
			messageId: `msg-${i}`,
			uid: i + 1,
		}));

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
