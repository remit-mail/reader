import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";
import {
	createFolder,
	type FolderDeps,
	renameFolder,
} from "./folder-operations.js";
import { MailboxQueueService } from "./mailbox-queue.js";
import { folderInAccount } from "./ownership.js";
import type { Refusable } from "./refusal.js";
import {
	captureQueue,
	openStore,
	type QueueCapture,
	type Store,
	seedAccount,
	seedMailbox,
} from "./test-helpers/test-store.js";

let store: Store;
let capture: QueueCapture;
let account: AccountItem;
let deps: FolderDeps;

beforeEach(async () => {
	capture = captureQueue();
	store = await openStore();
	account = await seedAccount(store);
	deps = {
		account: store.account,
		mailbox: store.mailbox,
		mailboxQueue: new MailboxQueueService({
			mailboxService: store.mailbox,
			sqsQueueUrl: "http://localhost:4566/000000000000/mailbox",
		}),
	};
});

afterEach(async () => {
	capture.restore();
	await store.close();
});

const rename = (
	mailbox: MailboxItem,
	fullPath: string,
	accountConfigId = account.accountConfigId,
): Promise<Refusable<MailboxItem>> =>
	renameFolder(deps, accountConfigId, {
		accountId: mailbox.accountId,
		mailboxId: mailbox.mailboxId,
		fullPath,
	});

const refusalOf = <T>(outcome: Refusable<T>) => {
	assert.equal(outcome.ok, false, "expected a refusal");
	return outcome.ok ? undefined : outcome.refusal;
};

const invalid = (message: string) => ({ kind: "Invalid", message });

describe("renameFolder refuses a rename no retry could satisfy", () => {
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

	it("refuses a caller who does not own the account, recording nothing", async () => {
		const folder = await seedMailbox(store, account, "Receipts");

		assert.deepEqual(refusalOf(await rename(folder, "Paperwork", "cfg-x")), {
			kind: "Forbidden",
			message: `Account ${account.accountId} not in account config`,
		});
		const after = await store.mailbox.get(account.accountId, folder.mailboxId);
		assert.equal(after.syncStatus, MailboxSyncStatus.synced);
		assert.deepEqual(capture.sent, []);
	});
});

describe("renameFolder records a pending rename the mail server settles", () => {
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
});

describe("createFolder", () => {
	it("records a pending folder and queues its create", async () => {
		const outcome = await createFolder(deps, account.accountConfigId, {
			accountId: account.accountId,
			namespaceType: "personal",
			fullPath: "Receipts",
		});

		assert.equal(outcome.ok, true);
		assert.equal(outcome.ok && outcome.value.syncStatus, "pending");
		assert.deepEqual(
			capture.sent.map((event) => event.body.type),
			["MAILBOX_CREATE"],
		);
	});

	it("refuses a path the account already has", async () => {
		await seedMailbox(store, account, "Receipts");

		const outcome = await createFolder(deps, account.accountConfigId, {
			accountId: account.accountId,
			namespaceType: "personal",
			fullPath: "Receipts",
		});

		assert.deepEqual(
			refusalOf(outcome),
			invalid("A folder named “Receipts” is already there."),
		);
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
