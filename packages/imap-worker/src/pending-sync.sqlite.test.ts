import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "@remit/backend/client";
import { MailboxLockRepo } from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import { mockClient } from "aws-sdk-client-mock";
import type {
	clearPendingSyncMessages as ClearPendingSyncMessages,
	emitEvent as EmitEvent,
} from "./emit.js";
import type { SyncMessagesEvent } from "./events.js";
import { emitMailboxResync, emitMoveResync } from "./handlers/message-move.js";
import { emitSyncMessagesEvents } from "./handlers/sync-mailboxes.js";

const ACCOUNT = "account-1366";
const FOLDERS = [
	{ mailboxId: "mbx-inbox", fullPath: "INBOX" },
	{ mailboxId: "mbx-sent", fullPath: "Sent" },
	{ mailboxId: "mbx-archive", fullPath: "Archive" },
];

const sqsMock = mockClient(SQSClient);

let emitEvent: typeof EmitEvent;
let clearPendingSyncMessages: typeof ClearPendingSyncMessages;
let locks: MailboxLockRepo;
let closeStore: () => void;

type Queued = { mailboxId: string; eventId: string };

const queued = (): Queued[] =>
	sqsMock.commandCalls(SendMessageCommand).map((call) => {
		const body = JSON.parse(call.args[0].input.MessageBody ?? "{}") as Queued;
		return { mailboxId: body.mailboxId, eventId: body.eventId };
	});

const inboxSync = (): Omit<SyncMessagesEvent, "eventId" | "timestamp"> => ({
	type: "SYNC_MESSAGES",
	accountId: ACCOUNT,
	mailboxId: "mbx-inbox",
});

const fanOut = (): Promise<void> =>
	emitSyncMessagesEvents(ACCOUNT, FOLDERS, emitEvent);

before(async () => {
	const fifo = (name: string) =>
		`https://sqs.eu-west-1.amazonaws.com/0/test-${name}.fifo`;
	process.env.SQS_QUEUE_URL_MAILBOXES = fifo("mailboxes");
	process.env.SQS_QUEUE_URL_MESSAGES = fifo("messages");
	process.env.SQS_QUEUE_URL_FLAGS = fifo("flags");
	({ emitEvent, clearPendingSyncMessages } = await import("./emit.js"));
});

beforeEach(() => {
	sqsMock.reset();
	sqsMock.on(SendMessageCommand).resolves({});
	const store = createShippedSqliteDb();
	closeStore = store.close;
	locks = new MailboxLockRepo(store.db);
	setClient({ mailboxLock: locks } as unknown as RemitClient);
});

afterEach(() => {
	_resetForTest();
	closeStore();
});

describe("SYNC_MESSAGES under explicit refreshes (#1366)", () => {
	it("queues one event per folder however many rounds arrive while none has started", async () => {
		for (let round = 0; round < 25; round += 1) await fanOut();

		assert.deepEqual(
			queued()
				.map((event) => event.mailboxId)
				.sort(),
			["mbx-archive", "mbx-inbox", "mbx-sent"],
		);
	});

	it("queues a folder again once its pending sync has started", async () => {
		await fanOut();
		const inbox = queued().find((event) => event.mailboxId === "mbx-inbox");
		if (!inbox) throw new Error("INBOX was not queued");

		await clearPendingSyncMessages(locks, { accountId: ACCOUNT, ...inbox });
		await fanOut();

		assert.equal(queued().length, FOLDERS.length + 1);
		assert.equal(queued().at(-1)?.mailboxId, "mbx-inbox");
	});

	it("keeps a folder's pending marker when a stale event starts", async () => {
		await fanOut();
		await clearPendingSyncMessages(locks, {
			accountId: ACCOUNT,
			mailboxId: "mbx-inbox",
			eventId: "an-event-from-before-the-marker",
		});
		await fanOut();

		assert.equal(queued().length, FOLDERS.length);
	});

	it("takes the same marker for a move's resync and a delete's resync", async () => {
		await emitMoveResync(emitEvent, {
			accountId: ACCOUNT,
			sourceMailboxId: "mbx-inbox",
			destinationMailboxId: "mbx-sent",
		});
		await emitMailboxResync(emitEvent, {
			accountId: ACCOUNT,
			mailboxId: "mbx-inbox",
		});
		await fanOut();

		assert.equal(queued().length, FOLDERS.length);
	});

	it("takes over a marker whose event was lost once it has expired", async () => {
		await locks.tryAcquireLock(
			"mbx-inbox",
			"SYNC_MESSAGES_PENDING",
			ACCOUNT,
			"lost-event",
			-1,
		);

		await emitEvent(inboxSync());

		assert.equal(queued().length, 1);
	});

	it("releases the marker when the send fails, so the next round is not swallowed", async () => {
		sqsMock
			.on(SendMessageCommand)
			.rejectsOnce(new Error("queue unreachable"))
			.resolves({});

		await assert.rejects(emitEvent(inboxSync()), /queue unreachable/);
		await emitEvent(inboxSync());

		assert.equal(queued().length, 2);
	});

	it("fails the operation when the marker store fails", async () => {
		setClient({
			mailboxLock: {
				get: async () => null,
				tryAcquireLock: async () => {
					throw new Error("marker store down");
				},
			},
		} as unknown as RemitClient);

		await assert.rejects(emitEvent(inboxSync()), /marker store down/);
		assert.equal(sqsMock.commandCalls(SendMessageCommand).length, 0);
	});
});
