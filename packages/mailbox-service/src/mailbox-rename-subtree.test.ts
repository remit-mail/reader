import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";
import { MailboxManagementService } from "./mailbox-management.js";
import { FolderGoneUpstreamError } from "./mailbox-upstream.js";
import {
	type FakeImapConnection,
	FakeImapServer,
} from "./test-helpers/fake-imap.js";
import {
	beforeNext,
	openStore,
	type Store,
	seedAccount,
	seedMailbox,
} from "./test-helpers/test-store.js";

let store: Store;
let imap: FakeImapServer;
let account: AccountItem;

beforeEach(async () => {
	store = await openStore();
	imap = new FakeImapServer();
	account = await seedAccount(store);
});

afterEach(() => store.close());

const folder = async (
	fullPath: string,
	pendingPath?: string,
	overrides: Partial<MailboxItem> = {},
): Promise<MailboxItem> => {
	imap.addFolder(fullPath);
	const mailbox = await seedMailbox(store, account, fullPath, { overrides });
	if (!pendingPath) return mailbox;
	const recorded = await store.mailbox.transition(
		account.accountId,
		mailbox.mailboxId,
		{
			from: [MailboxSyncStatus.synced],
			to: MailboxSyncStatus.pending,
			set: { pendingPath },
		},
	);
	if (!recorded) throw new Error(`could not record a rename on ${fullPath}`);
	return recorded;
};

const current = (mailbox: MailboxItem) =>
	store.mailbox.get(account.accountId, mailbox.mailboxId);

const management = () => new MailboxManagementService(store.mailbox);

const renameWork = (connection: FakeImapConnection = imap.connection()) =>
	management().syncRename(
		account.accountId,
		workId as string,
		"Work",
		"Projects",
		async () => connection,
	);

let workId: string | undefined;

const work = async (
	pendingPath: string | null = "Projects",
	overrides: Partial<MailboxItem> = {},
) => {
	const mailbox = await folder("Work", pendingPath ?? undefined, overrides);
	workId = mailbox.mailboxId;
	return mailbox;
};

const assertAt = async (
	mailbox: MailboxItem,
	fullPath: string,
	syncStatus: MailboxItem["syncStatus"],
	pendingPath?: string,
) => {
	const row = await current(mailbox);
	assert.equal(row.fullPath, fullPath);
	assert.equal(row.syncStatus, syncStatus);
	assert.equal(row.pendingPath, pendingPath);
};

describe("MailboxManagementService.syncRename settles one intent", () => {
	it("renames on the server and adopts the path on every row that carried the intent", async () => {
		const parent = await work();
		const child = await folder("Work/2026", "Projects/2026");
		const grandchild = await folder("Work/2026/Q1", "Projects/2026/Q1");

		const result = await renameWork();

		assert.equal(result.success, true);
		assert.ok(imap.hasFolder("Projects/2026/Q1"));
		await assertAt(parent, "Projects", MailboxSyncStatus.synced);
		await assertAt(child, "Projects/2026", MailboxSyncStatus.synced);
		await assertAt(grandchild, "Projects/2026/Q1", MailboxSyncStatus.synced);
	});

	it("adopts the path the server resolved over the one requested", async () => {
		const parent = await work();
		const child = await folder("Work/2026", "Projects/2026");
		imap.namespacePrefix = "INBOX/";

		await renameWork();

		await assertAt(parent, "INBOX/Projects", MailboxSyncStatus.synced);
		await assertAt(child, "INBOX/Projects/2026", MailboxSyncStatus.synced);
	});

	it("leaves rows it must not claim alone", async () => {
		const parent = await work();
		const interloper = await folder("Projects/Fresh");
		const elsewhere = await folder("Admin", "Beheer");
		const sameBranch = await folder("Other", "Projects/Old");
		const offRebase = await folder("Work/2026", "Projects/Archief");

		await renameWork();

		await assertAt(parent, "Projects", MailboxSyncStatus.synced);
		await assertAt(interloper, "Projects/Fresh", MailboxSyncStatus.synced);
		await assertAt(elsewhere, "Admin", MailboxSyncStatus.pending, "Beheer");
		await assertAt(
			sameBranch,
			"Other",
			MailboxSyncStatus.pending,
			"Projects/Old",
		);
		await assertAt(
			offRebase,
			"Work/2026",
			MailboxSyncStatus.pending,
			"Projects/Archief",
		);
	});

	it("settles the rest when a descendant is deleted mid-settle", async () => {
		const parent = await work();
		const gone = await folder("Work/Gone", "Projects/Gone");
		const child = await folder("Work/2026", "Projects/2026");
		beforeNext(store.mailbox, "transition", () =>
			store.mailbox.delete(account.accountId, gone.mailboxId),
		);

		const result = await renameWork();

		assert.equal(result.success, true);
		await assertAt(parent, "Projects", MailboxSyncStatus.synced);
		await assertAt(child, "Projects/2026", MailboxSyncStatus.synced);
	});

	for (const [label, pendingPath] of [
		["already settled", null],
		["pending for another target", "Beheer"],
	] as const) {
		it(`issues no RENAME when the row is ${label}`, async () => {
			await work(pendingPath);

			const result = await renameWork();

			assert.equal(result.success, true);
			assert.ok(imap.hasFolder("Work"));
			assert.equal(imap.hasFolder("Projects"), false);
		});
	}
});

describe("MailboxManagementService.syncRename reads a NONEXISTENT answer", () => {
	it("settles when the source has moved because the rename already landed", async () => {
		const parent = await work();
		await imap.connection().renameMailbox("Work", "Projects");

		const result = await renameWork();

		assert.equal(result.success, true);
		await assertAt(parent, "Projects", MailboxSyncStatus.synced);
	});

	it("reads the target through the account's namespace prefix", async () => {
		const parent = await work("Projects", {
			hierarchyDelimiter: ".",
			namespacePrefix: "INBOX.",
		});
		imap.removeFolder("Work");
		imap.addFolder("INBOX.Projects");

		const result = await renameWork();

		assert.equal(result.success, true);
		assert.equal((await current(parent)).syncStatus, MailboxSyncStatus.synced);
	});

	it("reports the folder gone, carrying the server's answer, when neither path is listed", async () => {
		await work();
		imap.removeFolder("Work");

		await assert.rejects(
			renameWork(),
			(error: unknown) =>
				error instanceof FolderGoneUpstreamError &&
				(error.cause as { serverResponseCode?: string })?.serverResponseCode ===
					"NONEXISTENT",
		);
	});

	it("refuses rather than confirming a delete when the source is still listed", async () => {
		await work();
		const connection = imap.connection();
		connection.renameMailbox = async () => {
			throw Object.assign(new Error("Command failed"), {
				serverResponseCode: "NONEXISTENT",
			});
		};

		await assert.rejects(
			renameWork(connection),
			(error: unknown) =>
				!(error instanceof FolderGoneUpstreamError) &&
				(error as { serverResponseCode?: string }).serverResponseCode ===
					"NONEXISTENT",
		);
	});

	it("refuses rather than confirming a delete when the listing cannot be read", async () => {
		await work();
		imap.removeFolder("Work");
		const connection = imap.connection();
		connection.listMailboxes = async () => {
			throw new Error("IMAP connection lost");
		};

		await assert.rejects(
			renameWork(connection),
			(error: unknown) => !(error instanceof FolderGoneUpstreamError),
		);
	});
});

describe("MailboxManagementService.failRename", () => {
	const fail = () =>
		management().failRename(
			account.accountId,
			workId as string,
			"Work",
			"Projects",
			"Permission denied",
		);

	it("marks every row this rename recorded failed, keeping path and target", async () => {
		const parent = await work();
		const child = await folder("Work/2026", "Projects/2026");
		const other = await folder("Other", "Projects/Old");

		await fail();

		await assertAt(parent, "Work", MailboxSyncStatus.failed, "Projects");
		await assertAt(
			child,
			"Work/2026",
			MailboxSyncStatus.failed,
			"Projects/2026",
		);
		await assertAt(other, "Other", MailboxSyncStatus.pending, "Projects/Old");
	});

	it("raises a NotFoundError when the folder row is gone", async () => {
		workId = "mbx-gone";

		await assert.rejects(
			fail(),
			(error: unknown) => (error as Error).name === "NotFoundError",
		);
	});

	it("records nothing, quietly, for a row that carries no intent", async () => {
		const parent = await work(null);

		await fail();

		await assertAt(parent, "Work", MailboxSyncStatus.synced);
	});

	it("fails a rename the connection never issued as a refusal", async () => {
		const parent = await work();
		const connection = imap.connection();
		connection.renameMailbox = async () => {
			throw new Error(
				'Rename of "Work" was not issued: the IMAP connection is not ready',
			);
		};

		await assert.rejects(renameWork(connection), /not ready/);
		await fail();

		await assertAt(parent, "Work", MailboxSyncStatus.failed, "Projects");
	});
});
