import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
	syncMailboxesPendingName,
	triggerAccountSync,
} from "@remit/backend/trigger-sync";
import { MailboxLockRepo } from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import { emitSyncMessagesEvents } from "./handlers/sync-mailboxes.js";
import {
	clearPendingSyncMessages,
	emitSyncMessagesOnce,
} from "./pending-sync.js";

type Recorded = { accountId: string; mailboxId: string; eventId: string };

const ACCOUNT = "account-1366";
const FOLDERS = [
	{ mailboxId: "mbx-inbox", fullPath: "INBOX" },
	{ mailboxId: "mbx-sent", fullPath: "Sent" },
	{ mailboxId: "mbx-archive", fullPath: "Archive" },
];

let locks: MailboxLockRepo;
let close: () => void;
let queued: Recorded[];

beforeEach(() => {
	const store = createShippedSqliteDb();
	close = store.close;
	locks = new MailboxLockRepo(store.db);
	queued = [];
});

afterEach(() => {
	close();
});

const recordingEmit = async (
	event: { accountId: string; mailboxId: string },
	options: { eventId: string },
): Promise<void> => {
	queued.push({
		accountId: event.accountId,
		mailboxId: event.mailboxId,
		eventId: options.eventId,
	});
};

const fanOut = (): Promise<void> =>
	emitSyncMessagesEvents(ACCOUNT, FOLDERS, (event) =>
		emitSyncMessagesOnce(locks, event, recordingEmit),
	);

describe("SYNC_MESSAGES fan-out under explicit refreshes (#1366)", () => {
	it("queues one event per folder however many rounds arrive while none has started", async () => {
		for (let round = 0; round < 25; round += 1) await fanOut();

		assert.deepEqual(queued.map((event) => event.mailboxId).sort(), [
			"mbx-archive",
			"mbx-inbox",
			"mbx-sent",
		]);
	});

	it("queues a folder again once its pending sync has started", async () => {
		await fanOut();
		const inbox = queued.find((event) => event.mailboxId === "mbx-inbox");
		if (!inbox) throw new Error("INBOX was not queued");

		await clearPendingSyncMessages(locks, inbox);
		await fanOut();

		assert.equal(queued.length, FOLDERS.length + 1);
		assert.equal(queued.at(-1)?.mailboxId, "mbx-inbox");
	});

	it("keeps a folder's pending marker when a stale event starts", async () => {
		await fanOut();
		await clearPendingSyncMessages(locks, {
			accountId: ACCOUNT,
			mailboxId: "mbx-inbox",
			eventId: "an-event-from-before-the-marker",
		});
		await fanOut();

		assert.equal(queued.length, FOLDERS.length);
	});

	it("releases the marker when the enqueue fails, so the next round is not swallowed", async () => {
		await assert.rejects(
			emitSyncMessagesOnce(
				locks,
				{ type: "SYNC_MESSAGES", accountId: ACCOUNT, mailboxId: "mbx-inbox" },
				async () => {
					throw new Error("queue unreachable");
				},
			),
			/queue unreachable/,
		);

		await emitSyncMessagesOnce(
			locks,
			{ type: "SYNC_MESSAGES", accountId: ACCOUNT, mailboxId: "mbx-inbox" },
			recordingEmit,
		);

		assert.equal(queued.length, 1);
	});

	it("fails the operation when the marker store fails", async () => {
		const broken = {
			tryAcquireLock: async (): Promise<boolean> => {
				throw new Error("marker store down");
			},
			releaseLock: async (): Promise<void> => {},
		};

		await assert.rejects(
			emitSyncMessagesOnce(
				broken,
				{ type: "SYNC_MESSAGES", accountId: ACCOUNT, mailboxId: "mbx-inbox" },
				recordingEmit,
			),
			/marker store down/,
		);
		assert.equal(queued.length, 0);
	});
});

describe("SYNC_MAILBOXES triggers under explicit refreshes (#1366)", () => {
	const sent: SendMessageCommand[] = [];
	const sqsClient = {
		send: async (command: SendMessageCommand) => {
			sent.push(command);
			return {};
		},
	} as unknown as SQSClient;

	const trigger = (explicitRequest: boolean) =>
		triggerAccountSync({
			sqsClient,
			markers: locks,
			queueUrl: "https://queue.test/remit-mailboxes.fifo",
			accountId: ACCOUNT,
			explicitRequest,
		});

	beforeEach(() => {
		sent.length = 0;
	});

	it("queues one explicit SYNC_MAILBOXES for an account however many polls arrive", async () => {
		const outcomes = await Promise.all(
			Array.from({ length: 40 }, () => trigger(true)),
		);

		assert.equal(sent.length, 1);
		assert.equal(outcomes.filter((outcome) => outcome.enqueued).length, 1);
	});

	it("queues again once the pending event has started", async () => {
		const first = await trigger(true);
		if (!first.enqueued) throw new Error("first trigger was not queued");

		await locks.releaseLock(
			ACCOUNT,
			ACCOUNT,
			syncMailboxesPendingName(true),
			first.eventId,
		);
		await trigger(true);

		assert.equal(sent.length, 2);
	});

	it("does not let a pending side-effect trigger swallow an explicit refresh", async () => {
		await trigger(false);
		await trigger(true);

		assert.equal(sent.length, 2);
	});
});
