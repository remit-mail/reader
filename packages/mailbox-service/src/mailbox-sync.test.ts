import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IMailboxRepository,
	IMailboxSpecialUseRepository,
} from "@remit/data-ports";
import {
	MailboxCursorState,
	MailboxSpecialUse,
	MailboxSyncStatus,
} from "@remit/domain-enums";
import { parseImapAttributes } from "./attribute-mapper.js";
import { MailboxSyncService } from "./mailbox-sync.js";
import type { IImapConnection, ImapNamespaces } from "./types.js";

describe("parseImapAttributes – locale invariance (#194)", () => {
	it("recognizes \\Sent regardless of folder name", () => {
		const dutch = parseImapAttributes(["\\HasNoChildren", "\\Sent"]);
		assert.deepEqual(dutch.specialUse, [MailboxSpecialUse.Sent]);

		const english = parseImapAttributes(["\\Sent"]);
		assert.deepEqual(english.specialUse, [MailboxSpecialUse.Sent]);
	});

	it("recognizes \\Drafts on a localized 'Concepten' folder", () => {
		// IMAP server tells us the flag — the folder name is irrelevant.
		const parsed = parseImapAttributes(["\\Drafts"]);
		assert.deepEqual(parsed.specialUse, [MailboxSpecialUse.Drafts]);
	});

	it("returns an empty list when no flag is present", () => {
		// A real user folder like Outlook NL's "Nieuwsbrieven" carries no
		// SPECIAL-USE attributes — leave it untouched downstream.
		const parsed = parseImapAttributes(["\\HasNoChildren"]);
		assert.deepEqual(parsed.specialUse, []);
	});

	it("normalizes case: \\sent is treated the same as \\Sent", () => {
		const parsed = parseImapAttributes(["\\sent"]);
		assert.deepEqual(parsed.specialUse, [MailboxSpecialUse.Sent]);
	});
});

describe("MailboxSyncService.syncMailboxes — UIDVALIDITY cursor detection (#1272)", () => {
	const namespaces: ImapNamespaces = {
		personal: [{ prefix: "", delimiter: "/" }],
		other: [],
		shared: [],
	};

	const buildConnection = (
		uidValidity: number,
		highestModseq = "0",
	): IImapConnection =>
		({
			getNamespaces: async () => namespaces,
			listMailboxes: async () => [
				{
					fullPath: "INBOX",
					name: "INBOX",
					delimiter: "/",
					attributes: [],
					parentPath: null,
				},
			],
			getMailboxStatus: async () => ({
				messages: 5,
				recent: 0,
				unseen: 1,
				uidNext: 100,
				uidValidity,
				highestModseq,
				deletedCount: 0,
			}),
		}) as unknown as IImapConnection;

	const buildServices = (
		existingUidValidity: number,
		existingCursorState?: string,
	) => {
		const updateCalls: Array<Record<string, unknown>> = [];
		const mailboxService = {
			listByAccount: async () => ({
				items: [
					{
						mailboxId: "mbx-1",
						fullPath: "INBOX",
						uidNext: 100,
						uidValidity: existingUidValidity,
						messageCount: 5,
						unseenCount: 1,
						deletedCount: 0,
						highestModseq: "0",
						specialUse: undefined,
						cursorState: existingCursorState,
					},
				],
				continuationToken: undefined,
			}),
			update: async (
				_accountId: string,
				_mailboxId: string,
				patch: Record<string, unknown>,
			) => {
				updateCalls.push(patch);
				return {};
			},
			delete: async () => undefined,
			create: async () => ({}),
		} as unknown as IMailboxRepository;

		const specialUseService = {
			listByMailboxId: async () => [],
			deleteByMailboxId: async () => undefined,
			createMany: async () => undefined,
		} as unknown as IMailboxSpecialUseRepository;

		return { mailboxService, specialUseService, updateCalls };
	};

	it("trips cursor_invalid when the STATUS sweep observes a changed UIDVALIDITY", async () => {
		const { mailboxService, specialUseService, updateCalls } = buildServices(1);
		const service = new MailboxSyncService(mailboxService, specialUseService);
		const connection = buildConnection(2);

		await service.syncMailboxes({ accountId: "acc-1" }, connection);

		const uidValidityUpdate = updateCalls.find((c) => "uidValidity" in c);
		assert.ok(uidValidityUpdate, "expected the sweep to write the mailbox");
		assert.equal(
			uidValidityUpdate?.cursorState,
			MailboxCursorState.cursor_invalid,
		);
	});

	it("does not write anything when UIDVALIDITY (and everything else) is unchanged", async () => {
		const { mailboxService, specialUseService, updateCalls } = buildServices(1);
		const service = new MailboxSyncService(mailboxService, specialUseService);
		const connection = buildConnection(1);

		await service.syncMailboxes({ accountId: "acc-1" }, connection);

		assert.equal(updateCalls.length, 0);
	});

	it("never writes the message-sync cursor, whatever the server reports", async () => {
		// `highestModseq` on the mailbox row is message sync's own cursor over
		// applied changes, not a status projection. The sweep overwriting it with
		// the server's current value would step it over every change message sync
		// had not yet applied.
		const { mailboxService, specialUseService, updateCalls } = buildServices(1);
		const service = new MailboxSyncService(mailboxService, specialUseService);
		const connection = buildConnection(2, "99999");

		await service.syncMailboxes({ accountId: "acc-1" }, connection);

		for (const call of updateCalls) {
			assert.equal("highestModseq" in call, false);
		}
	});

	it("does not sweep-write a mailbox whose only difference is the server mod-sequence", async () => {
		const { mailboxService, specialUseService, updateCalls } = buildServices(1);
		const service = new MailboxSyncService(mailboxService, specialUseService);
		const connection = buildConnection(1, "4242");

		await service.syncMailboxes({ accountId: "acc-1" }, connection);

		assert.equal(updateCalls.length, 0);
	});

	it("does not re-trip (no cursorState write) when the mailbox is already cursor_invalid", async () => {
		const { mailboxService, specialUseService, updateCalls } = buildServices(
			1,
			MailboxCursorState.cursor_invalid,
		);
		const service = new MailboxSyncService(mailboxService, specialUseService);
		const connection = buildConnection(2);

		await service.syncMailboxes({ accountId: "acc-1" }, connection);

		const uidValidityUpdate = updateCalls.find((c) => "uidValidity" in c);
		assert.ok(uidValidityUpdate);
		assert.equal("cursorState" in (uidValidityUpdate ?? {}), false);
	});
});

describe("MailboxSyncService.syncMailboxes — reconcile does not delete pending folders (#290)", () => {
	const namespaces: ImapNamespaces = {
		personal: [{ prefix: "", delimiter: "/" }],
		other: [],
		shared: [],
	};

	// The server lists only INBOX: neither user folder is on it yet.
	const serverConnection = (): IImapConnection =>
		({
			getNamespaces: async () => namespaces,
			listMailboxes: async () => [
				{
					fullPath: "INBOX",
					name: "INBOX",
					delimiter: "/",
					attributes: [],
					parentPath: null,
				},
			],
			getMailboxStatus: async () => ({
				messages: 0,
				recent: 0,
				unseen: 0,
				uidNext: 1,
				uidValidity: 1,
				highestModseq: "0",
				deletedCount: 0,
			}),
		}) as unknown as IImapConnection;

	const buildServices = (
		existing: Array<{
			mailboxId: string;
			fullPath: string;
			syncStatus?: string;
		}>,
	) => {
		const deleted: string[] = [];
		const mailboxService = {
			listByAccount: async () => ({
				items: existing.map((m) => ({
					mailboxId: m.mailboxId,
					fullPath: m.fullPath,
					uidNext: 1,
					uidValidity: 1,
					messageCount: 0,
					unseenCount: 0,
					deletedCount: 0,
					highestModseq: "0",
					specialUse: undefined,
					syncStatus: m.syncStatus,
				})),
				continuationToken: undefined,
			}),
			update: async () => ({}),
			delete: async (_accountId: string, mailboxId: string) => {
				deleted.push(mailboxId);
			},
			create: async () => ({}),
		} as unknown as IMailboxRepository;

		const specialUseService = {
			listByMailboxId: async () => [],
			deleteByMailboxId: async () => undefined,
			createMany: async () => undefined,
		} as unknown as IMailboxSpecialUseRepository;

		return { mailboxService, specialUseService, deleted };
	};

	it("keeps a pending folder the server has not listed yet", async () => {
		// The folder was just created locally; MAILBOX_CREATE has not reached the
		// server, so the LIST omits it. Deleting the row here races the create and
		// wedges the account's mailbox-sync FIFO group for a full visibility window.
		const { mailboxService, specialUseService, deleted } = buildServices([
			{
				mailboxId: "inbox",
				fullPath: "INBOX",
				syncStatus: MailboxSyncStatus.synced,
			},
			{
				mailboxId: "pending-folder",
				fullPath: "New Folder",
				syncStatus: MailboxSyncStatus.pending,
			},
		]);
		const service = new MailboxSyncService(mailboxService, specialUseService);

		const result = await service.syncMailboxes(
			{ accountId: "acc-1" },
			serverConnection(),
		);

		assert.deepEqual(deleted, []);
		assert.equal(result.deleted, 0);
	});

	it("still deletes a synced folder that has left the server", async () => {
		// A folder that was confirmed on the server and is now gone is a genuine
		// server-side deletion; the reconcile must still reap it.
		const { mailboxService, specialUseService, deleted } = buildServices([
			{
				mailboxId: "inbox",
				fullPath: "INBOX",
				syncStatus: MailboxSyncStatus.synced,
			},
			{
				mailboxId: "synced-gone",
				fullPath: "Old Folder",
				syncStatus: MailboxSyncStatus.synced,
			},
		]);
		const service = new MailboxSyncService(mailboxService, specialUseService);

		const result = await service.syncMailboxes(
			{ accountId: "acc-1" },
			serverConnection(),
		);

		assert.deepEqual(deleted, ["synced-gone"]);
		assert.equal(result.deleted, 1);
	});
});
