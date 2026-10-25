import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "@remit/backend/client";
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
import type { SyncMessagesEvent } from "./events.js";
import { emitMailboxResync, emitMoveResync } from "./handlers/message-move.js";
import { emitSyncMessagesEvents } from "./handlers/sync-mailboxes.js";
import { workerQueuesOn } from "./test-helpers/worker-queues.js";

const ACCOUNT = "account-1366";
const FOLDERS = [
	{ mailboxId: "mbx-inbox", fullPath: "INBOX" },
	{ mailboxId: "mbx-sent", fullPath: "Sent" },
	{ mailboxId: "mbx-archive", fullPath: "Archive" },
];

let queue: RecordingQueue;
let locks: MailboxLockRepo;
let closeStore: () => void;

type Queued = { mailboxId: string; eventId: string };

const queued = (): Queued[] =>
	queue.sent.map(({ body }) => ({
		mailboxId: String(body.mailboxId),
		eventId: String(body.eventId),
	}));

const inboxSync = (): Omit<SyncMessagesEvent, "eventId" | "timestamp"> => ({
	type: "SYNC_MESSAGES",
	accountId: ACCOUNT,
	mailboxId: "mbx-inbox",
});

const emitEvent: EmitEvent = (event) =>
	createEmitEvent(workerQueuesOn(queue))(event);

const fanOut = (): Promise<void> =>
	emitSyncMessagesEvents(ACCOUNT, FOLDERS, emitEvent);

beforeEach(() => {
	queue = recordingQueue();
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

		await locks.releaseLock(
			ACCOUNT,
			inbox.mailboxId,
			SYNC_MESSAGES_PENDING,
			inbox.eventId,
		);
		await fanOut();

		assert.equal(queued().length, FOLDERS.length + 1);
		assert.equal(queued().at(-1)?.mailboxId, "mbx-inbox");
	});

	it("keeps a folder's pending marker when a stale event starts", async () => {
		await fanOut();
		await locks.releaseLock(
			ACCOUNT,
			"mbx-inbox",
			SYNC_MESSAGES_PENDING,
			"an-event-from-before-the-marker",
		);
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
		let sends = 0;
		queue.answer(async () => {
			sends += 1;
			if (sends === 1) throw new Error("queue unreachable");
		});

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
		assert.equal(queue.sent.length, 0);
	});
});
