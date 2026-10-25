import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";
import {
	changeFolderPath,
	createFolder,
	type FolderPathOutcome,
} from "./folder-operations.js";
import { fifoMailboxManagement, MailboxQueueService } from "./mailbox-queue.js";
import { folderInAccount } from "./ownership.js";
import type { Refusable } from "./refusal.js";
import {
	openStore,
	type RecordingQueue,
	recordingQueue,
	type Store,
	seedAccount,
	seedMailbox,
} from "./test-helpers/test-store.js";

let store: Store;
let capture: RecordingQueue;
let account: AccountItem;
let mailboxQueue: MailboxQueueService;

beforeEach(async () => {
	capture = recordingQueue();
	store = await openStore();
	account = await seedAccount(store);
	mailboxQueue = new MailboxQueueService({
		mailboxService: store.mailbox,
		enqueue: fifoMailboxManagement(capture.fifo),
	});
});

afterEach(async () => {
	await store.close();
});

const rename = (
	mailbox: MailboxItem,
	fullPath: string,
): Promise<Refusable<FolderPathOutcome>> =>
	changeFolderPath(
		{ account: store.account, mailbox: store.mailbox, mailboxQueue },
		account.accountConfigId,
		{
			accountId: mailbox.accountId,
			mailboxId: mailbox.mailboxId,
			fullPath,
		},
	);

const refusalOf = <T>(outcome: Refusable<T>) => {
	assert.equal(outcome.ok, false, "expected a refusal");
	return outcome.ok ? undefined : outcome.refusal;
};

const invalid = (message: string) => ({ kind: "Invalid", message });

describe("changeFolderPath refuses a rename no retry could satisfy", () => {
	it("keeps INBOX where it is", async () => {
		const inbox = await seedMailbox(store, account, "INBOX");

		assert.deepEqual(
			refusalOf(await rename(inbox, "Old inbox")),
			invalid("The inbox can't be renamed."),
		);
	});

	it("keeps the INBOX name for the inbox", async () => {
		const folder = await seedMailbox(store, account, "Receipts");

		assert.deepEqual(
			refusalOf(await rename(folder, "inbox")),
			invalid("“INBOX” is reserved for the inbox."),
		);
	});

	it("needs a name", async () => {
		const folder = await seedMailbox(store, account, "Receipts");

		assert.deepEqual(
			refusalOf(await rename(folder, "  ")),
			invalid("A folder needs a name."),
		);
	});

	it("keeps a system folder's conventional name free", async () => {
		const folder = await seedMailbox(store, account, "Receipts");

		assert.deepEqual(
			refusalOf(await rename(folder, "Projects/Trash")),
			invalid("“Trash” is reserved for a system folder. Pick another name."),
		);
	});

	it("refuses a path another folder holds", async () => {
		await seedMailbox(store, account, "Archive 2024");
		const folder = await seedMailbox(store, account, "Receipts");

		assert.deepEqual(
			refusalOf(await rename(folder, "Archive 2024")),
			invalid("A folder named “Archive 2024” is already there."),
		);
	});

	it("refuses a path a pending rename is heading for", async () => {
		const first = await seedMailbox(store, account, "Bills");
		const second = await seedMailbox(store, account, "Receipts");
		assert.equal((await rename(first, "Paperwork")).ok, true);

		assert.deepEqual(
			refusalOf(await rename(second, "Paperwork")),
			invalid("“Bills” is already being renamed to “Paperwork”."),
		);
	});
});

describe("changeFolderPath records a pending rename the mail server settles", () => {
	it("keeps the confirmed path, records the target and queues the rename", async () => {
		const folder = await seedMailbox(store, account, "Receipts");

		const outcome = await rename(folder, "Paperwork");

		assert.equal(outcome.ok, true);
		const row = await store.mailbox.get(account.accountId, folder.mailboxId);
		assert.equal(row.fullPath, "Receipts");
		assert.equal(row.pendingPath, "Paperwork");
		assert.equal(row.syncStatus, MailboxSyncStatus.pending);
		assert.deepEqual(
			capture.sent.map((event) => event.body.type),
			["MAILBOX_RENAME"],
		);
	});

	it("dismisses a failed rename when asked for the path the folder has", async () => {
		const folder = await seedMailbox(store, account, "Receipts");
		await store.mailbox.transition(account.accountId, folder.mailboxId, {
			from: [MailboxSyncStatus.synced],
			to: MailboxSyncStatus.failed,
			set: { pendingPath: "Paperwork" },
		});

		const outcome = await rename(folder, "Receipts");

		assert.equal(outcome.ok, true);
		const row = await store.mailbox.get(account.accountId, folder.mailboxId);
		assert.equal(row.syncStatus, MailboxSyncStatus.synced);
		assert.equal(row.pendingPath, undefined);
		assert.deepEqual(capture.sent, []);
	});

	it("returns the recorded intent when asked for the target it is already heading for", async () => {
		const folder = await seedMailbox(store, account, "Receipts");
		assert.equal((await rename(folder, "Paperwork")).ok, true);

		const again = await rename(folder, "Paperwork");

		assert.equal(again.ok && again.value.outcome, "AlreadyRecorded");
		assert.equal(again.ok && again.value.mailbox.pendingPath, "Paperwork");
		assert.equal(capture.sent.length, 1);
	});

	it("refuses a new target while another change is in flight", async () => {
		const folder = await seedMailbox(store, account, "Receipts");
		assert.equal((await rename(folder, "Paperwork")).ok, true);

		assert.deepEqual(refusalOf(await rename(folder, "Bills")), {
			kind: "Conflict",
			message: `A rename is in progress for "Receipts".`,
		});
		assert.equal(capture.sent.length, 1);
	});
});

describe("createFolder", () => {
	it("records a pending folder and queues its create", async () => {
		const outcome = await createFolder(
			{ account: store.account, mailbox: store.mailbox, mailboxQueue },
			account.accountConfigId,
			{
				accountId: account.accountId,
				namespaceType: "personal",
				fullPath: "Receipts",
			},
		);

		assert.equal(outcome.ok, true);
		assert.equal(outcome.ok && outcome.value.outcome, "Created");
		assert.equal(outcome.ok && outcome.value.mailbox.syncStatus, "pending");
		assert.deepEqual(
			capture.sent.map((event) => event.body.type),
			["MAILBOX_CREATE"],
		);
	});

	it("returns the folder already at that path", async () => {
		const existing = await seedMailbox(store, account, "Receipts");

		const outcome = await createFolder(
			{ account: store.account, mailbox: store.mailbox, mailboxQueue },
			account.accountConfigId,
			{
				accountId: account.accountId,
				namespaceType: "personal",
				fullPath: "Receipts",
			},
		);

		assert.equal(outcome.ok && outcome.value.outcome, "Existing");
		assert.equal(
			outcome.ok && outcome.value.mailbox.mailboxId,
			existing.mailboxId,
		);
		assert.deepEqual(capture.sent, []);
	});
});

describe("createFolder for another tenant", () => {
	it("refuses a caller who does not own the account, recording nothing", async () => {
		const outcome = await createFolder(
			{ account: store.account, mailbox: store.mailbox, mailboxQueue },
			"cfg-x",
			{
				accountId: account.accountId,
				namespaceType: "personal",
				fullPath: "Receipts",
			},
		);

		assert.deepEqual(refusalOf(outcome), {
			kind: "Forbidden",
			message: `Account ${account.accountId} not in account config`,
		});
		assert.deepEqual(capture.sent, []);
	});
});

describe("changeFolderPath for another tenant", () => {
	it("refuses a caller who does not own the account, recording nothing", async () => {
		const folder = await seedMailbox(store, account, "Receipts");
		const outcome = await changeFolderPath(
			{ account: store.account, mailbox: store.mailbox, mailboxQueue },
			"cfg-x",
			{
				accountId: account.accountId,
				mailboxId: folder.mailboxId,
				fullPath: "Paperwork",
			},
		);

		assert.deepEqual(refusalOf(outcome), {
			kind: "Forbidden",
			message: `Account ${account.accountId} not in account config`,
		});
		assert.deepEqual(capture.sent, []);
	});
});

describe("folderInAccount", () => {
	it("refuses another account's folder as not found on a read", async () => {
		const other = await seedAccount(store, { accountConfigId: "cfg-other" });
		const theirs = await seedMailbox(store, other, "Receipts");

		assert.deepEqual(
			refusalOf(folderInAccount(theirs, account.accountId, "read")),
			{ kind: "NotFound", message: `Mailbox not found: ${theirs.mailboxId}` },
		);
	});
});
