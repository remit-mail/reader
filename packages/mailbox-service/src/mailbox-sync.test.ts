import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import {
	MailboxCursorState,
	MailboxSpecialUse,
	MailboxSyncStatus,
} from "@remit/domain-enums";
import { parseImapAttributes } from "./attribute-mapper.js";
import { MailboxSyncService } from "./mailbox-sync.js";
import {
	eml,
	type FakeImapConnection,
	FakeImapServer,
} from "./test-helpers/fake-imap.js";
import {
	openStore,
	type Store,
	seedAccount,
	seedMailbox,
	silentLog,
} from "./test-helpers/test-store.js";

describe("parseImapAttributes – locale invariance (#194)", () => {
	it("recognizes \\Sent regardless of folder name", () => {
		const dutch = parseImapAttributes(["\\HasNoChildren", "\\Sent"]);
		assert.deepEqual(dutch.specialUse, [MailboxSpecialUse.Sent]);

		const english = parseImapAttributes(["\\Sent"]);
		assert.deepEqual(english.specialUse, [MailboxSpecialUse.Sent]);
	});

	it("recognizes \\Drafts on a localized 'Concepten' folder", () => {
		const parsed = parseImapAttributes(["\\Drafts"]);
		assert.deepEqual(parsed.specialUse, [MailboxSpecialUse.Drafts]);
	});

	it("returns an empty list when no flag is present", () => {
		const parsed = parseImapAttributes(["\\HasNoChildren"]);
		assert.deepEqual(parsed.specialUse, []);
	});

	it("normalizes case: \\sent is treated the same as \\Sent", () => {
		const parsed = parseImapAttributes(["\\sent"]);
		assert.deepEqual(parsed.specialUse, [MailboxSpecialUse.Sent]);
	});
});

let store: Store;
let imap: FakeImapServer;
let account: AccountItem;

beforeEach(async () => {
	store = await openStore();
	imap = new FakeImapServer();
	account = await seedAccount(store);
});

afterEach(() => store.close());

const sweep = (connection: FakeImapConnection = imap.connection()) =>
	new MailboxSyncService(
		store.mailbox,
		store.mailboxSpecialUse,
		silentLog,
	).syncMailboxes({ accountId: account.accountId }, connection);

const rows = async () =>
	(await store.mailbox.listAllByAccount(account.accountId)).sort((a, b) =>
		a.fullPath.localeCompare(b.fullPath),
	);

const paths = async () => (await rows()).map((mailbox) => mailbox.fullPath);

const row = (mailbox: MailboxItem) =>
	store.mailbox.get(account.accountId, mailbox.mailboxId);

const byPath = async (fullPath: string) => {
	const found = await store.mailbox.findByPath(account.accountId, fullPath);
	if (!found) throw new Error(`no row at ${fullPath}`);
	return found;
};

const inState = async (
	fullPath: string,
	syncStatus: MailboxItem["syncStatus"],
	pendingPath?: string,
) => {
	const mailbox = await seedMailbox(store, account, fullPath, {
		overrides: { syncStatus },
	});
	if (!pendingPath) return mailbox;
	const recorded = await store.mailbox.transition(
		account.accountId,
		mailbox.mailboxId,
		{ from: [syncStatus], to: syncStatus, set: { pendingPath } },
	);
	if (!recorded) throw new Error(`could not record ${pendingPath}`);
	return recorded;
};

describe("the STATUS sweep and the mailbox cursor", () => {
	const swept = async () => {
		imap.addFolder("INBOX", { uidValidity: 1 });
		imap.deliver("INBOX", eml({}));
		await sweep();
		return byPath("INBOX");
	};

	it("trips cursor_invalid without touching the message-sync cursor", async () => {
		const inbox = await swept();
		imap.renumber("INBOX", 2);

		await sweep();

		const after = await row(inbox);
		assert.equal(after.cursorState, MailboxCursorState.cursor_invalid);
		assert.equal(after.highestModseq, inbox.highestModseq);
	});

	it("writes nothing when only the server mod-sequence moved", async () => {
		const inbox = await swept();
		imap.store("INBOX", [1], ["\\Flagged"]);

		await sweep();

		assert.deepEqual(await row(inbox), inbox);
	});
});

describe("reconciling the folder list", () => {
	for (const syncStatus of [
		MailboxSyncStatus.pending,
		MailboxSyncStatus.deleting,
	]) {
		it(`keeps a ${syncStatus} folder the server omits or lists as \\Noselect`, async () => {
			imap.addFolder("INBOX");
			imap.addFolder("Half", { attributes: ["\\Noselect"] });
			await inState("New Folder", syncStatus);
			await inState("Half", syncStatus);

			const result = await sweep();

			assert.equal(result.deleted, 0);
			assert.deepEqual(await paths(), ["Half", "INBOX", "New Folder"]);
		});
	}

	it("deletes a synced folder that has left the server", async () => {
		imap.addFolder("INBOX");
		await seedMailbox(store, account, "Old Folder");

		const result = await sweep();

		assert.equal(result.deleted, 1);
		assert.deepEqual(await paths(), ["INBOX"]);
	});

	it("discovers a new folder as synced", async () => {
		imap.addFolder("INBOX");

		await sweep();

		assert.equal((await byPath("INBOX")).syncStatus, MailboxSyncStatus.synced);
	});

	it("inserts no second row for the path a pending rename is on its way to", async () => {
		imap.addFolder("INBOX");
		imap.addFolder("Records/2025");
		await inState("Archive/2025", MailboxSyncStatus.pending, "Records/2025");

		const result = await sweep();

		assert.equal(result.created, 1);
		assert.deepEqual(await paths(), ["Archive/2025", "INBOX"]);
	});

	it("discovers a failed rename's target as a folder of its own", async () => {
		imap.addFolder("INBOX");
		imap.addFolder("Archive/2025");
		imap.addFolder("Records/2025");
		await inState("Archive/2025", MailboxSyncStatus.failed, "Records/2025");

		await sweep();

		assert.deepEqual(await paths(), ["Archive/2025", "INBOX", "Records/2025"]);
	});
});

describe("a lookalike of a flagged folder", () => {
	it("keeps folders called Deleted and Bin beside the flagged Trash", async () => {
		imap.addFolder("INBOX");
		imap.addFolder("Trash", { attributes: ["\\Trash"] });
		imap.addFolder("Deleted");
		imap.addFolder("Bin");

		await sweep();

		assert.deepEqual(await paths(), ["Bin", "Deleted", "INBOX", "Trash"]);
	});

	it("hides the unflagged twin of a folder the server flagged", async () => {
		imap.addFolder("INBOX");
		imap.addFolder("[Gmail]/Trash", { attributes: ["\\Trash"] });
		imap.addFolder("Trash");

		await sweep();

		assert.deepEqual(await paths(), ["[Gmail]/Trash", "INBOX"]);
	});

	it("keeps a folder that holds a role of its own", async () => {
		imap.addFolder("INBOX");
		imap.addFolder("Archive", { attributes: ["\\Archive"] });
		imap.addFolder("INBOX/All Mail");

		await sweep();

		assert.deepEqual(await paths(), ["Archive", "INBOX", "INBOX/All Mail"]);
	});
});

describe("a folder leaving mid-sweep", () => {
	const statusFailingFor = (
		path: string,
		before: () => Promise<unknown>,
		message: string,
	) => {
		const connection = imap.connection();
		const status = connection.getMailboxStatus;
		connection.getMailboxStatus = async (asked) => {
			if (asked !== path) return status(asked);
			await before();
			throw new Error(message);
		};
		return connection;
	};

	it("asks no STATUS of a folder mid-mutation and leaves its row alone", async () => {
		imap.addFolder("INBOX");
		imap.addFolder("Doomed");
		const doomed = await inState("Doomed", MailboxSyncStatus.deleting);
		const connection = imap.connection();
		const asked: string[] = [];
		const status = connection.getMailboxStatus;
		connection.getMailboxStatus = (path) => {
			asked.push(path);
			return status(path);
		};

		await sweep(connection);

		assert.deepEqual(asked, ["INBOX"]);
		assert.deepEqual(await row(doomed), doomed);
	});

	it("finishes the sweep when the folder whose STATUS failed has been deleted", async () => {
		imap.addFolder("INBOX");
		imap.addFolder("Doomed");
		await sweep();
		const doomed = await byPath("Doomed");

		await assert.doesNotReject(
			sweep(
				statusFailingFor(
					"Doomed",
					() => store.mailbox.delete(account.accountId, doomed.mailboxId),
					"Mailbox doesn't exist: Doomed",
				),
			),
		);
	});

	it("fails the sweep when the folder whose STATUS failed is still live", async () => {
		imap.addFolder("INBOX");
		imap.addFolder("Doomed");
		await sweep();

		await assert.rejects(
			sweep(
				statusFailingFor("Doomed", async () => {}, "connection reset by peer"),
			),
			/connection reset by peer/,
		);
	});
});
