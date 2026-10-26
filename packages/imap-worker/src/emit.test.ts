import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { IMailboxLockRepository } from "@remit/data-ports";
import {
	type RecordingQueue,
	recordingQueue,
} from "@remit/data-ports/recording-queue";
import { MailboxLockRepo } from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import {
	createEmitEvent,
	type EmitEvent,
	SYNC_MESSAGES_PENDING,
} from "./emit.js";
import type {
	FlagPushEvent,
	SyncMailboxesEvent,
	SyncMessageBodyEvent,
	SyncMessagesEvent,
} from "./events.js";
import { recordingMetrics } from "./test-helpers/process-context.js";
import { workerQueuesOn } from "./test-helpers/worker-queues.js";

type Emitted<T> = Omit<T, "eventId" | "timestamp">;

let locks: MailboxLockRepo;
let closeStore: () => void;
let mailboxLock: IMailboxLockRepository;
let queue: RecordingQueue;

const sentCommands = () => queue.sent;

const emitEvent: EmitEvent = (event) =>
	createEmitEvent({
		queues: workerQueuesOn(queue),
		mailboxLock,
		metrics: recordingMetrics(),
	})(event);

beforeEach(() => {
	queue = recordingQueue();
	const store = createShippedSqliteDb();
	closeStore = store.close;
	locks = new MailboxLockRepo(store.db);
	mailboxLock = locks;
});

afterEach(() => {
	closeStore();
});

describe("emitEvent on a FIFO queue", () => {
	it("groups by account and deduplicates on the event's own id", async () => {
		const event: Emitted<SyncMessagesEvent> = {
			type: "SYNC_MESSAGES",
			accountId: "acc-1",
			mailboxId: "mbx-1",
		};

		await emitEvent(event);

		const [sent] = sentCommands();
		if (!sent) throw new Error("expected a send");
		assert.equal(sent.groupId, "acc-1");
		assert.equal(sent.deduplicationId, sent.body.eventId);
	});

	// Issue #37: every SYNC_MESSAGES for a mailbox carried one dedup id, so
	// SQS FIFO's 5-minute window discarded the second sync of that mailbox
	// before any worker saw it — mail appended after a sync could not be
	// fetched until the window elapsed. Two syncs of one mailbox must both
	// reach the queue.
	it("lets a second sync of the same mailbox through", async () => {
		const event: Emitted<SyncMessagesEvent> = {
			type: "SYNC_MESSAGES",
			accountId: "acc-1",
			mailboxId: "mbx-1",
		};

		await emitEvent(event);
		const [first] = sentCommands();
		if (!first) throw new Error("expected a send");
		await locks.releaseLock(
			"acc-1",
			"mbx-1",
			SYNC_MESSAGES_PENDING,
			String(first.body.eventId),
		);
		await emitEvent(event);

		const sent = sentCommands();
		assert.equal(sent.length, 2);
		assert.notEqual(sent[0]?.deduplicationId, sent[1]?.deduplicationId);
	});

	it("lets a second sync of the same account's mailbox list through", async () => {
		const event: Emitted<SyncMailboxesEvent> = {
			type: "SYNC_MAILBOXES",
			accountId: "acc-1",
		};

		await emitEvent(event);
		await emitEvent(event);

		const sent = sentCommands();
		assert.equal(sent.length, 2);
		assert.notEqual(sent[0]?.deduplicationId, sent[1]?.deduplicationId);
	});

	// A FIFO queue without content-based deduplication rejects a send carrying
	// no MessageDeduplicationId, so every event routed onto one needs its own —
	// not only the sync events.
	it("gives a flag-push re-arm a deduplication id", async () => {
		const event: Emitted<FlagPushEvent> = {
			type: "FLAG_PUSH",
			accountId: "acc-1",
			accountConfigId: "cfg-1",
			messageId: "msg-1",
			flagName: "\\Seen",
		};

		await emitEvent(event);

		const [sent] = sentCommands();
		if (!sent) throw new Error("expected a send");
		assert.equal(sent.deduplicationId, sent.body.eventId);
	});
});

describe("emitEvent on a standard queue", () => {
	it("sends a body sync with no group or deduplication id", async () => {
		const event: Emitted<SyncMessageBodyEvent> = {
			type: "SYNC_MESSAGE_BODY",
			accountId: "acc-1",
			mailboxId: "mbx-1",
			messageIds: ["msg-1"],
		};

		await emitEvent(event);

		const [sent] = sentCommands();
		if (!sent) throw new Error("expected a send");
		assert.equal(sent.groupId, undefined);
		assert.equal(sent.deduplicationId, undefined);
	});
});
