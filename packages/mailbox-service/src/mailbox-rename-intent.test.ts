import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";
import { fifoMailboxManagement, MailboxQueueService } from "./mailbox-queue.js";
import {
	beforeNext,
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

beforeEach(async () => {
	capture = recordingQueue();
	queue = capture.sent;
	store = await openStore();
	account = await seedAccount(store);
});

afterEach(async () => {
	await store.close();
});

const folder = async (
	fullPath: string,
	state?: { syncStatus: MailboxItem["syncStatus"]; pendingPath?: string },
): Promise<MailboxItem> => {
	const mailbox = await seedMailbox(store, account, fullPath);
	if (!state) return mailbox;
	const moved = await store.mailbox.transition(
		account.accountId,
		mailbox.mailboxId,
		{
			from: [MailboxSyncStatus.synced],
			to: state.syncStatus,
			set: state.pendingPath ? { pendingPath: state.pendingPath } : {},
		},
	);
	if (!moved) throw new Error(`could not put ${fullPath} in its state`);
	return moved;
};

const queueService = () =>
	new MailboxQueueService({
		mailboxService: store.mailbox,
		enqueue: fifoMailboxManagement(capture.fifo),
	});

const rename = (mailbox: MailboxItem, newPath: string) =>
	queueService().renameMailbox(mailbox.mailboxId, newPath, account.accountId);

const dismiss = (mailbox: MailboxItem) =>
	queueService().dismissMailboxIntent(mailbox.mailboxId, account.accountId);

const current = (mailbox: MailboxItem) =>
	store.mailbox.get(account.accountId, mailbox.mailboxId);

const rejectsWith409 = (message: string) => (error: unknown) =>
	(error as { statusCode?: number }).statusCode === 409 &&
	(error as Error).message === message;

describe("MailboxQueueService.renameMailbox records the intent", () => {
	it("records the target over the subtree and leaves every confirmed path alone", async () => {
		const parent = await folder("Work");
		const child = await folder("Work/2026");
		const lookalike = await folder("Workshop");

		const renamed = await rename(parent, "Projects");

		assert.equal(renamed.mailboxId, parent.mailboxId);
		assert.equal((await current(parent)).fullPath, "Work");
		assert.equal((await current(parent)).pendingPath, "Projects");
		const movedChild = await current(child);
		assert.equal(movedChild.fullPath, "Work/2026");
		assert.equal(movedChild.pendingPath, "Projects/2026");
		assert.equal(movedChild.syncStatus, MailboxSyncStatus.pending);
		assert.equal(
			(await current(lookalike)).syncStatus,
			MailboxSyncStatus.synced,
		);
		assert.equal((await current(lookalike)).pendingPath, undefined);
	});

	it("records the path the RENAME carries, `$` patterns and all", async () => {
		const parent = await folder("Work");
		const child = await folder("Work/2026");

		await rename(parent, "Q1$&Q2");

		assert.equal((await current(child)).pendingPath, "Q1$&Q2/2026");
		assert.deepEqual(
			queue.map((event) => event.body.newPath),
			["Q1$&Q2"],
		);
	});

	it("records a retry from a failed rename onto the same row", async () => {
		const parent = await folder("Work", {
			syncStatus: MailboxSyncStatus.failed,
			pendingPath: "Projects",
		});

		await rename(parent, "Projects");

		const retried = await current(parent);
		assert.equal(retried.syncStatus, MailboxSyncStatus.pending);
		assert.equal(retried.pendingPath, "Projects");
	});

	it("refuses the whole subtree with a 409 naming the descendant that blocks it", async () => {
		const parent = await folder("Archive");
		await folder("Archive/2025/Receipts", {
			syncStatus: MailboxSyncStatus.pending,
			pendingPath: "Archive/2025/Bonnen",
		});

		await assert.rejects(
			rename(parent, "Archief"),
			rejectsWith409(
				'A rename is in progress for "Archive/2025/Receipts", inside this folder.',
			),
		);

		assert.equal((await current(parent)).syncStatus, MailboxSyncStatus.synced);
		assert.equal(queue.length, 0);
	});

	it("refuses with a 409 naming the folder's own delete", async () => {
		const parent = await folder("Archive", {
			syncStatus: MailboxSyncStatus.deleting,
		});

		await assert.rejects(
			rename(parent, "Archief"),
			rejectsWith409('A delete is already in progress for "Archive".'),
		);
	});

	it("answers 404 when the folder went between the read and the intent", async () => {
		const parent = await folder("Work");
		beforeNext(store.mailbox, "transitionSubtree", () =>
			store.mailbox.delete(account.accountId, parent.mailboxId),
		);

		await assert.rejects(
			rename(parent, "Projects"),
			(error: unknown) => (error as Error).name === "NotFoundError",
		);
	});
});

describe("MailboxQueueService.dismissMailboxIntent", () => {
	it("clears a failed rename over its whole subtree and enqueues nothing", async () => {
		const parent = await folder("Work", {
			syncStatus: MailboxSyncStatus.failed,
			pendingPath: "Projects",
		});
		const child = await folder("Work/2026", {
			syncStatus: MailboxSyncStatus.failed,
			pendingPath: "Projects/2026",
		});
		const other = await folder("Other", {
			syncStatus: MailboxSyncStatus.failed,
			pendingPath: "Projects/Old",
		});

		const dismissed = await dismiss(parent);

		assert.equal(dismissed.syncStatus, MailboxSyncStatus.synced);
		for (const mailbox of [parent, child]) {
			const row = await current(mailbox);
			assert.equal(row.syncStatus, MailboxSyncStatus.synced);
			assert.equal(row.pendingPath, undefined);
		}
		assert.equal((await current(other)).pendingPath, "Projects/Old");
		assert.equal(queue.length, 0);
	});

	it("dismisses a failed delete on the named folder alone", async () => {
		const parent = await folder("Work", {
			syncStatus: MailboxSyncStatus.failed,
		});
		const child = await folder("Work/2026", {
			syncStatus: MailboxSyncStatus.failed,
		});

		await dismiss(parent);

		assert.equal((await current(parent)).syncStatus, MailboxSyncStatus.synced);
		assert.equal((await current(child)).syncStatus, MailboxSyncStatus.failed);
	});

	it("leaves a folder with nothing to dismiss as it is", async () => {
		const work = await folder("Work");

		assert.equal((await dismiss(work)).syncStatus, MailboxSyncStatus.synced);
	});

	it("refuses with a 409 while a mutation is still in flight", async () => {
		const work = await folder("Work", {
			syncStatus: MailboxSyncStatus.pending,
			pendingPath: "Projects",
		});

		await assert.rejects(
			dismiss(work),
			rejectsWith409('A rename is in progress for "Work".'),
		);
	});
});
