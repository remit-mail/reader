import assert from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";
import {
	MailboxManagementService,
	parseMailboxPath,
	validateMailboxOperation,
	validateMailboxPath,
} from "./mailbox-management.js";
import {
	type FakeImapConnection,
	FakeImapServer,
} from "./test-helpers/fake-imap.js";
import {
	openStore,
	type Store,
	seedAccount,
	seedMailbox,
} from "./test-helpers/test-store.js";

describe("parseMailboxPath", () => {
	it("parses simple path", () => {
		const result = parseMailboxPath("INBOX");
		assert.strictEqual(result.name, "INBOX");
		assert.strictEqual(result.parent, null);
		assert.strictEqual(result.depth, 1);
	});

	it("parses nested path with default delimiter", () => {
		const result = parseMailboxPath("Work/Projects/ClientA");
		assert.strictEqual(result.name, "ClientA");
		assert.strictEqual(result.parent, "Work/Projects");
		assert.strictEqual(result.depth, 3);
	});

	it("parses nested path with custom delimiter", () => {
		const result = parseMailboxPath("Work.Projects.ClientA", ".");
		assert.strictEqual(result.name, "ClientA");
		assert.strictEqual(result.parent, "Work.Projects");
		assert.strictEqual(result.depth, 3);
	});

	it("handles two-level path", () => {
		const result = parseMailboxPath("Personal/Archive");
		assert.strictEqual(result.name, "Archive");
		assert.strictEqual(result.parent, "Personal");
		assert.strictEqual(result.depth, 2);
	});
});

describe("validateMailboxPath", () => {
	it("throws on empty path", () => {
		assert.throws(() => validateMailboxPath(""), {
			message: "Mailbox path cannot be empty",
		});
	});

	it("throws on whitespace-only path", () => {
		assert.throws(() => validateMailboxPath("   "), {
			message: "Mailbox path cannot be empty",
		});
	});

	it("throws on double delimiters", () => {
		assert.throws(() => validateMailboxPath("Work//Projects"), {
			message: "Mailbox path cannot contain empty hierarchy levels",
		});
	});

	it("throws on leading delimiter", () => {
		assert.throws(() => validateMailboxPath("/Work/Projects"), {
			message: "Mailbox path cannot start or end with hierarchy delimiter",
		});
	});

	it("throws on trailing delimiter", () => {
		assert.throws(() => validateMailboxPath("Work/Projects/"), {
			message: "Mailbox path cannot start or end with hierarchy delimiter",
		});
	});

	it("accepts valid simple path", () => {
		assert.doesNotThrow(() => validateMailboxPath("INBOX"));
	});

	it("accepts valid nested path", () => {
		assert.doesNotThrow(() => validateMailboxPath("Work/Projects/ClientA"));
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

const pending = (fullPath: string) =>
	seedMailbox(store, account, fullPath, {
		overrides: { syncStatus: MailboxSyncStatus.pending },
	});

const syncCreate = (
	mailbox: MailboxItem,
	connection: FakeImapConnection = imap.connection(),
	subscribe?: boolean,
) =>
	new MailboxManagementService(store.mailbox).syncCreate(
		account.accountId,
		mailbox.mailboxId,
		mailbox.fullPath,
		async () => connection,
		subscribe,
	);

const current = (mailbox: MailboxItem) =>
	store.mailbox.get(account.accountId, mailbox.mailboxId);

describe("MailboxManagementService.syncCreate", () => {
	it("adopts the path the server created under its prefix, keeping the row", async () => {
		imap.namespacePrefix = "INBOX/";
		const requested = await pending("Notifications");

		const result = await syncCreate(requested);

		assert.strictEqual(result.success, true);
		assert.ok(imap.hasFolder("INBOX/Notifications"));
		const row = await current(requested);
		assert.strictEqual(row.fullPath, "INBOX/Notifications");
		assert.strictEqual(row.syncStatus, MailboxSyncStatus.synced);
	});

	it("drops the pending row when the server path already has a folder (#318)", async () => {
		imap.namespacePrefix = "INBOX/";
		imap.addFolder("INBOX/Notifications");
		const existing = await seedMailbox(store, account, "INBOX/Notifications");
		const requested = await pending("Notifications");

		const result = await syncCreate(requested);

		assert.deepStrictEqual(result, {
			success: true,
			existing: {
				mailboxId: existing.mailboxId,
				fullPath: "INBOX/Notifications",
			},
		});
		await assert.rejects(current(requested));
	});

	it("keeps the requested path when the server does", async () => {
		const requested = await pending("Work");

		await syncCreate(requested);

		const row = await current(requested);
		assert.strictEqual(row.fullPath, "Work");
		assert.strictEqual(row.syncStatus, MailboxSyncStatus.synced);
	});

	it("still adopts the server path when the fresh list cannot resolve it", async () => {
		imap.namespacePrefix = "INBOX/";
		const requested = await pending("Notifications");
		const connection = imap.connection();
		connection.listMailboxes = async () => [];

		await syncCreate(requested, connection);

		assert.strictEqual(
			(await current(requested)).fullPath,
			"INBOX/Notifications",
		);
	});

	it("falls back to the requested path when the create result names none", async () => {
		const requested = await pending("Archive");
		const connection = imap.connection();
		const create = connection.createMailbox;
		connection.createMailbox = async (path) => {
			await create(path);
			return { created: true } as { path: string; created: boolean };
		};

		await syncCreate(requested, connection, true);

		assert.strictEqual(imap.isSubscribed("Archive"), true);
		const row = await current(requested);
		assert.strictEqual(row.fullPath, "Archive");
		assert.strictEqual(row.syncStatus, MailboxSyncStatus.synced);
	});

	it("does not settle a row a rename has claimed since", async () => {
		const requested = await pending("Archive");
		await store.mailbox.transition(account.accountId, requested.mailboxId, {
			from: [MailboxSyncStatus.pending],
			to: MailboxSyncStatus.pending,
			set: { pendingPath: "Archief" },
		});

		await syncCreate(requested);

		const row = await current(requested);
		assert.strictEqual(row.syncStatus, MailboxSyncStatus.pending);
		assert.strictEqual(row.pendingPath, "Archief");
	});
});

describe("validateMailboxOperation", () => {
	it("throws when deleting INBOX", () => {
		assert.throws(() => validateMailboxOperation("delete", "INBOX"), {
			message: "Cannot delete INBOX",
		});
	});

	it("throws when deleting INBOX (case insensitive)", () => {
		assert.throws(() => validateMailboxOperation("delete", "inbox"), {
			message: "Cannot delete INBOX",
		});
	});

	it("allows deleting other mailboxes", () => {
		assert.doesNotThrow(() => validateMailboxOperation("delete", "Archive"));
	});

	it("throws when renaming INBOX", () => {
		// The server would move INBOX's mail to the new name and leave an empty
		// INBOX behind — a bulk move, not a path update (D5). The API refuses it;
		// this is the worker's backstop.
		assert.throws(() => validateMailboxOperation("rename", "INBOX"), {
			message: "Cannot rename INBOX",
		});
	});

	it("allows renaming other mailboxes", () => {
		assert.doesNotThrow(() => validateMailboxOperation("rename", "Archive"));
	});
});
