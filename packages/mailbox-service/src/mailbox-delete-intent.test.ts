import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";
import { MailboxManagementService } from "./mailbox-management.js";
import { fifoMailboxManagement, MailboxQueueService } from "./mailbox-queue.js";
import {
	openStore,
	type RecordedMessage,
	type RecordingQueue,
	recordingQueue,
	type Store,
	seedAccount,
	seedMailbox,
} from "./test-helpers/test-store.js";

let store: Store;
let capture: RecordingQueue;
let queue: RecordedMessage[];
let account: AccountItem;
let receipts: MailboxItem;

beforeEach(async () => {
	capture = recordingQueue();
	queue = capture.sent;
	store = await openStore();
	account = await seedAccount(store);
	receipts = await seedMailbox(store, account, "Receipts");
});

afterEach(async () => {
	await store.close();
});

const markAs = (syncStatus: MailboxItem["syncStatus"], pendingPath?: string) =>
	store.mailbox.transition(account.accountId, receipts.mailboxId, {
		from: [MailboxSyncStatus.synced],
		to: syncStatus,
		set: pendingPath ? { pendingPath } : {},
	});

const requestDelete = () =>
	new MailboxQueueService({
		mailboxService: store.mailbox,
		enqueue: fifoMailboxManagement(capture.fifo),
	}).deleteMailbox(receipts.mailboxId, account.accountId);

const current = () => store.mailbox.get(account.accountId, receipts.mailboxId);

const management = () => new MailboxManagementService(store.mailbox);

describe("MailboxQueueService.deleteMailbox records the intent", () => {
	it("records deleting and enqueues one DELETE naming the server's path", async () => {
		await requestDelete();

		assert.equal((await current()).syncStatus, MailboxSyncStatus.deleting);
		assert.deepEqual(
			queue.map((event) => event.body.path),
			["Receipts"],
		);
	});

	it("accepts a retry from a failed delete", async () => {
		await markAs(MailboxSyncStatus.failed);

		await requestDelete();

		assert.equal((await current()).syncStatus, MailboxSyncStatus.deleting);
		assert.equal(queue.length, 1);
	});

	it("answers a second delete with a 409 and enqueues nothing", async () => {
		await requestDelete();

		await assert.rejects(
			requestDelete(),
			(error: unknown) =>
				(error as { statusCode?: number }).statusCode === 409 &&
				(error as Error).message ===
					'A delete is already in progress for "Receipts".',
		);
		assert.equal(queue.length, 1);
	});

	it("answers a delete during a rename with a 409 naming the rename", async () => {
		await markAs(MailboxSyncStatus.pending, "Bonnen");

		await assert.rejects(
			requestDelete(),
			(error: unknown) =>
				(error as Error).message === 'A rename is in progress for "Receipts".',
		);
	});
});

describe("MailboxManagementService.failDelete", () => {
	it("marks the row failed and keeps its path, with no rename target", async () => {
		await requestDelete();

		await management().failDelete(
			account.accountId,
			receipts.mailboxId,
			"Permission denied",
		);

		const failed = await current();
		assert.equal(failed.syncStatus, MailboxSyncStatus.failed);
		assert.equal(failed.fullPath, "Receipts");
		assert.equal(failed.pendingPath, undefined);
	});

	it("raises a NotFoundError when the row is gone", async () => {
		await assert.rejects(
			management().failDelete(account.accountId, "mbx-gone", "denied"),
			(error: unknown) => (error as Error).name === "NotFoundError",
		);
	});
});
