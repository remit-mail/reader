import assert from "node:assert";
import { afterEach, describe, test } from "node:test";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { Logger } from "@remit/logger-lambda";
import type { SyncedMessage } from "@remit/mailbox-service";
import { mockClient } from "aws-sdk-client-mock";
import { resetBodySyncGateCache } from "../body-sync-gate.js";
import { __warmPoolSizeForTest } from "../connection-scope.js";
import type { SyncMessageBodyEvent } from "../events.js";
import {
	buildRetryEvent,
	resolveBatch,
	syncMessageBody,
} from "./sync-message-body.js";
import { BODY_BATCH_SIZE, batchSyncedMessages } from "./sync-messages.js";

const silentLogger = (() => {
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

	test("throws if a failed id has no uid in the map (never defaults to 0)", () => {
		// A wrong UID (0) would silently fetch the wrong message on retry; the
		// invariant is that every failed id came from this batch's uid map.
		assert.throws(
			() =>
				buildRetryEvent(
					baseEvent.accountId,
					baseEvent.mailboxId,
					["missing"],
					uidMap,
				),
			/No uid for failed messageId missing/,
		);
	});
});

describe("syncMessageBody — pause gate runs before connection reuse", () => {
	afterEach(() => {
		mockClient(SSMClient).reset();
		resetBodySyncGateCache();
	});

	test("paused: acks-and-skips before borrowing a warm connection", async () => {
		const accountId = "paused-account-zzz";
		mockClient(SSMClient)
			.on(GetParameterCommand)
			.resolves({ Parameter: { Value: "false" } });

		const event: SyncMessageBodyEvent = {
			...baseEvent,
			accountId,
			messageIds: ["msg-1"],
			messages: [{ messageId: "msg-1", uid: 101 }],
		};

		await syncMessageBody(event, silentLogger);

		// Returning at the gate must not touch the warm pool (no account lookup,
		// no IMAP connection) — proves the gate is first.
		assert.strictEqual(
			__warmPoolSizeForTest(accountId),
			0,
			"paused handler must not create a warm connection",
		);
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
