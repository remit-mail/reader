import assert from "node:assert";
import { afterEach, describe, mock, test } from "node:test";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { getClient } from "@remit/backend/client";
import type { AccountItem, MailboxItem } from "@remit/remit-electrodb-service";
import { AccountService, MailboxService } from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/logger-lambda";
import {
	BodySyncService,
	type SyncedMessage,
} from "@remit/mailbox-service";
import { mockClient } from "aws-sdk-client-mock";
import { resetBodySyncGateCache } from "../body-sync-gate.js";
import { __warmPoolSizeForTest } from "../connection-scope.js";
import type { SyncMessageBodyEvent } from "../events.js";
import {
	BODY_SYNC_MAX_ATTEMPTS,
	buildRetryableFailureError,
	getBodySyncMaxAttempts,
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

	test("is a real Error instance so it propagates like any other failure", () => {
		const error = buildRetryableFailureError(["msg-1"], 2);
		assert.ok(error instanceof Error);
	});

	test("BODY_SYNC_MAX_ATTEMPTS matches the body queue's maxReceiveCount (3)", () => {
		// See MAX_RECEIVE_COUNT in infra/stacks/dev/stacks/remit-queue-stack.ts.
		assert.equal(BODY_SYNC_MAX_ATTEMPTS, 3);
	});
});

describe("getBodySyncMaxAttempts — env-derived, CDK-injected threshold (#1270)", () => {
	test("parses the CDK-injected env var (derived from the queue's MAX_RECEIVE_COUNT)", () => {
		assert.equal(getBodySyncMaxAttempts({ BODY_SYNC_MAX_ATTEMPTS: "3" }), 3);
		assert.equal(getBodySyncMaxAttempts({ BODY_SYNC_MAX_ATTEMPTS: "5" }), 5);
	});

	test("defaults to 3 when unset (local dev, unit tests) — matches the queue's own default", () => {
		assert.equal(getBodySyncMaxAttempts({}), 3);
	});

	test("defaults to 3 on a non-numeric or non-positive value", () => {
		assert.equal(getBodySyncMaxAttempts({ BODY_SYNC_MAX_ATTEMPTS: "nope" }), 3);
		assert.equal(getBodySyncMaxAttempts({ BODY_SYNC_MAX_ATTEMPTS: "0" }), 3);
		assert.equal(getBodySyncMaxAttempts({ BODY_SYNC_MAX_ATTEMPTS: "-1" }), 3);
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

describe("syncMessageBody — DLQ propagation (integrated, #1270)", () => {
	const accountId = "cap-account-zzz";
	const mailboxId = "cap-mailbox-zzz";

	const cappedAccount = (): AccountItem =>
		({
			accountId,
			accountConfigId: "cap-acfg-zzz",
			connectionState: "authenticated",
			username: "cap@imap.example.com",
			imapHost: "imap.example.com",
			imapPort: 993,
			imapTls: true,
			// deserializeEncryptedPayload just needs base64-decodable strings; the
			// mocked secrets.decrypt below never inspects the actual bytes.
			passwordHash: JSON.stringify({
				encryptedDek: "",
				encryptedData: "",
				iv: "",
				authTag: "",
			}),
		}) as unknown as AccountItem;

	const cappedMailbox = (): MailboxItem =>
		({ fullPath: "INBOX" }) as unknown as MailboxItem;

	afterEach(() => {
		mock.restoreAll();
		mockClient(SSMClient).reset();
		mockClient(SQSClient).reset();
		resetBodySyncGateCache();
	});

	test("below BODY_SYNC_MAX_ATTEMPTS: throws instead of re-enqueueing, so SQS redelivers the record (issue #1270)", async () => {
		// This is the mechanism that lets a genuine processing failure ever reach
		// the body-dlq: the handler used to swallow every failure into a fresh
		// SQS SendMessage and always return successfully, so the queue's own
		// maxReceiveCount/DLQ never engaged. Throwing here is what index.ts's SQS
		// handler turns into a batchItemFailure, which SQS then redelivers.
		mockClient(SSMClient)
			.on(GetParameterCommand)
			.resolves({ Parameter: { Value: "true" } });
		const sqsMock = mockClient(SQSClient);

		mock.method(AccountService.prototype, "get", async () => cappedAccount());
		mock.method(MailboxService.prototype, "get", async () => cappedMailbox());
		mock.method(
			(await getClient()).secrets,
			"decrypt",
			async () => "fake-password",
		);
		mock.method(BodySyncService.prototype, "syncBodies", async () => ({
			syncedCount: 0,
			syncedMessageIds: [],
			skippedCount: 0,
			failedCount: 1,
			failedMessageIds: ["msg-1"],
		}));

		const event: SyncMessageBodyEvent = {
			...baseEvent,
			accountId,
			mailboxId,
			messageIds: ["msg-1"],
			messages: [{ messageId: "msg-1", uid: 101 }],
		};

		await assert.rejects(
			() => syncMessageBody(event, silentLogger, 1),
			(err: unknown) =>
				err instanceof Error &&
				/Body sync failed for 1 message/.test(err.message),
		);

		assert.equal(
			sqsMock.commandCalls(SendMessageCommand).length,
			0,
			"no manual re-enqueue — SQS's own redelivery owns the retry now",
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
