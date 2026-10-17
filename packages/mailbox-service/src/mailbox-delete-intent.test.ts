import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";
import { MailboxManagementService } from "./mailbox-management.js";
import { MailboxQueueService } from "./mailbox-queue.js";
import { FakeImapServer } from "./test-helpers/fake-imap.js";
import {
	captureQueue,
	openStore,
	type QueueCapture,
	type QueuedEvent,
	type Store,
	seedAccount,
	seedMailbox,
	seedMessage,
} from "./test-helpers/test-store.js";

let store: Store;
let capture: QueueCapture;
let queue: QueuedEvent[];
let imap: FakeImapServer;
let account: AccountItem;
let receipts: MailboxItem;

beforeEach(async () => {
	capture = captureQueue();
	queue = capture.sent;
	store = await openStore();
	imap = new FakeImapServer();
	imap.addFolder("Receipts");
	account = await seedAccount(store);
	receipts = await seedMailbox(store, account, "Receipts");
});

afterEach(async () => {
	capture.restore();
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
		sqsQueueUrl: "http://localhost:4566/000000000000/mailbox",
	}).deleteMailbox(receipts.mailboxId, account.accountId);

const current = () => store.mailbox.get(account.accountId, receipts.mailboxId);

const management = () => new MailboxManagementService(store.mailbox);

const syncDelete = (connection = imap.connection()) =>
	management().syncDelete(
		account.accountId,
		receipts.mailboxId,
		"Receipts",
		async () => connection,
	);

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

describe("MailboxManagementService.syncDelete settles the intent", () => {
	it("deletes the server folder and the folder's mail with the row", async () => {
		const { message } = await seedMessage(store, account, receipts, 1);
		await requestDelete();

		const result = await syncDelete();

		assert.equal(result.success, true);
		assert.equal(imap.hasFolder("Receipts"), false);
		await assert.rejects(current());
		await assert.rejects(store.message.get(message.messageId));
		assert.deepEqual(
			await store.threadMessage.findAllByMessageId(
				account.accountConfigId,
				message.messageId,
			),
			[],
		);
	});

	it("issues no DELETE for a row that is not deleting", async () => {
		const result = await syncDelete();

		assert.equal(result.success, true);
		assert.equal(imap.hasFolder("Receipts"), true);
		assert.ok(await current());
	});

	it("issues no second DELETE on a redelivery after the row is gone", async () => {
		await requestDelete();
		await management().settleDelete(account.accountId, receipts.mailboxId);

		const result = await syncDelete();

		assert.equal(result.success, true);
		assert.deepEqual(imap.commands("DELETE"), []);
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
