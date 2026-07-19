import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { mockClient } from "aws-sdk-client-mock";
import type { emitEvent as EmitEvent } from "./emit.js";
import type {
	FlagPushEvent,
	SyncMailboxesEvent,
	SyncMessageBodyEvent,
	SyncMessagesEvent,
} from "./events.js";

type Emitted<T> = Omit<T, "eventId" | "timestamp">;

// The queue urls are read once, at import. Point them at FIFO queues first —
// this suite is about what emitEvent puts on a FIFO queue, which is what both
// the self-host stack and the deployed stack run (deploy/vps/queues.json).
const fifo = (name: string) =>
	`https://sqs.eu-west-1.amazonaws.com/0/test-${name}.fifo`;

const sqsMock = mockClient(SQSClient);

let emitEvent: typeof EmitEvent;

const sentCommands = (): SendMessageCommand["input"][] =>
	sqsMock.commandCalls(SendMessageCommand).map((call) => call.args[0].input);

const bodyOf = (input: SendMessageCommand["input"]): Record<string, unknown> =>
	JSON.parse(input.MessageBody ?? "{}") as Record<string, unknown>;

before(async () => {
	process.env.SQS_QUEUE_URL_MAILBOXES = fifo("mailboxes");
	process.env.SQS_QUEUE_URL_MESSAGES = fifo("messages");
	process.env.SQS_QUEUE_URL_FLAGS = fifo("flags");
	({ emitEvent } = await import("./emit.js"));
});

beforeEach(() => {
	sqsMock.reset();
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
		assert.equal(sent.MessageGroupId, "acc-1");
		assert.equal(sent.MessageDeduplicationId, bodyOf(sent).eventId);
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
		await emitEvent(event);

		const sent = sentCommands();
		assert.equal(sent.length, 2);
		assert.notEqual(
			sent[0]?.MessageDeduplicationId,
			sent[1]?.MessageDeduplicationId,
		);
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
		assert.notEqual(
			sent[0]?.MessageDeduplicationId,
			sent[1]?.MessageDeduplicationId,
		);
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
		assert.equal(sent.MessageDeduplicationId, bodyOf(sent).eventId);
	});
});

describe("emitEvent on a standard queue", () => {
	it("carries no FIFO parameters", async () => {
		const event: Emitted<SyncMessageBodyEvent> = {
			type: "SYNC_MESSAGE_BODY",
			accountId: "acc-1",
			mailboxId: "mbx-1",
			messageIds: ["msg-1"],
		};

		await emitEvent(event);

		const [sent] = sentCommands();
		if (!sent) throw new Error("expected a send");
		assert.equal(sent.MessageGroupId, undefined);
		assert.equal(sent.MessageDeduplicationId, undefined);
	});
});
