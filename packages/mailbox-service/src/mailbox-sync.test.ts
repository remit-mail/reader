import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IMailboxRepository,
	IMailboxSpecialUseRepository,
} from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import {
	MailboxCursorState,
	MailboxSpecialUse,
	MailboxSyncStatus,
} from "@remit/domain-enums";
import { parseImapAttributes } from "./attribute-mapper.js";
import { type MailboxSyncLogger, MailboxSyncService } from "./mailbox-sync.js";

const silentLogger: MailboxSyncLogger = { info: () => {}, debug: () => {} };

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
		const service = new MailboxSyncService(
			mailboxService,
			specialUseService,
			silentLogger,
		);
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
		const service = new MailboxSyncService(
			mailboxService,
			specialUseService,
			silentLogger,
		);
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
		const service = new MailboxSyncService(
			mailboxService,
			specialUseService,
			silentLogger,
		);
		const connection = buildConnection(2, "99999");

		await service.syncMailboxes({ accountId: "acc-1" }, connection);

		for (const call of updateCalls) {
			assert.equal("highestModseq" in call, false);
		}
	});

	it("does not sweep-write a mailbox whose only difference is the server mod-sequence", async () => {
		const { mailboxService, specialUseService, updateCalls } = buildServices(1);
		const service = new MailboxSyncService(
			mailboxService,
			specialUseService,
			silentLogger,
		);
		const connection = buildConnection(1, "4242");

		await service.syncMailboxes({ accountId: "acc-1" }, connection);

		assert.equal(updateCalls.length, 0);
	});

	it("does not re-trip (no cursorState write) when the mailbox is already cursor_invalid", async () => {
		const { mailboxService, specialUseService, updateCalls } = buildServices(
			1,
			MailboxCursorState.cursor_invalid,
		);
		const service = new MailboxSyncService(
			mailboxService,
			specialUseService,
			silentLogger,
		);
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

	// The server lists only INBOX unless a test says otherwise: neither user
	// folder is on it yet.
	const serverConnection = (
		folders: Array<{ fullPath: string; attributes?: string[] }> = [
			{ fullPath: "INBOX" },
		],
	): IImapConnection =>
		({
			getNamespaces: async () => namespaces,
			listMailboxes: async () =>
				folders.map((folder) => ({
					fullPath: folder.fullPath,
					name: folder.fullPath.split("/").pop() ?? folder.fullPath,
					delimiter: "/",
					attributes: folder.attributes ?? [],
					parentPath: null,
				})),
			getMailboxStatus: async () => ({
				messages: 0,
				recent: 0,
				unseen: 0,
				uidNext: 1,
				uidValidity: 1,
				highestModseq: "0",
				deletedCount: 0,
			}),
			openBox: async () => ({
				uidvalidity: 1,
				uidnext: 1,
				messages: { total: 0 },
			}),
			closeBox: async () => undefined,
		}) as unknown as IImapConnection;

	const buildServices = (
		existing: Array<{
			mailboxId: string;
			fullPath: string;
			syncStatus?: string;
			pendingPath?: string;
		}>,
	) => {
		const deleted: string[] = [];
		const created: Array<Record<string, unknown>> = [];
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
					pendingPath: m.pendingPath,
				})),
				continuationToken: undefined,
			}),
			update: async () => ({}),
			delete: async (_accountId: string, mailboxId: string) => {
				deleted.push(mailboxId);
			},
			create: async (input: Record<string, unknown>) => {
				created.push(input);
				return { ...input, mailboxId: `new-${created.length}` };
			},
		} as unknown as IMailboxRepository;

		const specialUseService = {
			listByMailboxId: async () => [],
			deleteByMailboxId: async () => undefined,
			createMany: async () => undefined,
		} as unknown as IMailboxSpecialUseRepository;

		return { mailboxService, specialUseService, deleted, created };
	};

	for (const syncStatus of [
		MailboxSyncStatus.pending,
		MailboxSyncStatus.deleting,
	]) {
		it(`keeps a \`${syncStatus}\` folder the server has not listed`, async () => {
			// `pending`: the folder was just created locally and MAILBOX_CREATE has
			// not reached the server, so the LIST omits it — deleting the row races
			// the create and wedges the account's FIFO group for a visibility
			// window (#290).
			//
			// `deleting`: the delete has landed on the server and the worker has not
			// written back. Hard-deleting the row removes it under the client
			// holding its id — the "Mailbox not found" of #333 — and removes it
			// without the folder's mail, which the worker owns (D8).
			const { mailboxService, specialUseService, deleted } = buildServices([
				{
					mailboxId: "inbox",
					fullPath: "INBOX",
					syncStatus: MailboxSyncStatus.synced,
				},
				{
					mailboxId: "in-flight",
					fullPath: "New Folder",
					syncStatus,
				},
			]);
			const service = new MailboxSyncService(
				mailboxService,
				specialUseService,
				silentLogger,
			);

			const result = await service.syncMailboxes(
				{ accountId: "acc-1" },
				serverConnection(),
			);

			assert.deepEqual(deleted, []);
			assert.equal(result.deleted, 0);
		});

		it(`keeps a \`${syncStatus}\` folder the server lists as \\Noselect`, async () => {
			// A folder mid-create can transiently LIST as `\Noselect`, and the
			// non-selectable branch deleted the row before looking at its state.
			const { mailboxService, specialUseService, deleted } = buildServices([
				{
					mailboxId: "in-flight",
					fullPath: "New Folder",
					syncStatus,
				},
			]);
			const service = new MailboxSyncService(
				mailboxService,
				specialUseService,
				silentLogger,
			);

			await service.syncMailboxes(
				{ accountId: "acc-1" },
				serverConnection([
					{ fullPath: "INBOX" },
					{ fullPath: "New Folder", attributes: ["\\Noselect"] },
				]),
			);

			assert.deepEqual(deleted, []);
		});
	}

	it("does not insert a second row for a path a recorded rename claims", async () => {
		// D14. `fullPath` stays the path the server held when the intent was
		// recorded, so once the server executes RENAME the LIST returns a path no
		// row is keyed to. Without the pendingPath index the insert branch makes a
		// second row under a fresh mailboxId and initial-syncs the folder's mail
		// into it, leaving the original as a permanent phantom.
		const { mailboxService, specialUseService, deleted, created } =
			buildServices([
				{
					mailboxId: "inbox",
					fullPath: "INBOX",
					syncStatus: MailboxSyncStatus.synced,
				},
				{
					mailboxId: "renaming",
					fullPath: "Archive/2025",
					syncStatus: MailboxSyncStatus.pending,
					pendingPath: "Records/2025",
				},
			]);
		const service = new MailboxSyncService(
			mailboxService,
			specialUseService,
			silentLogger,
		);

		const result = await service.syncMailboxes(
			{ accountId: "acc-1" },
			serverConnection([{ fullPath: "INBOX" }, { fullPath: "Records/2025" }]),
		);

		assert.deepEqual(created, []);
		assert.equal(result.created, 0);
		assert.deepEqual(deleted, []);
	});

	it("lets a failed rename's target be discovered as a folder of its own", async () => {
		// A failed rename keeps its target so the UI can name what it was aiming
		// at (T6), and nothing clears it until the user retries or dismisses. If
		// the guard honoured that claim, one stuck folder would block the sweep
		// from ever seeing a real folder another client later created at that
		// path — permanently, and silently.
		const { mailboxService, specialUseService, created } = buildServices([
			{
				mailboxId: "stuck",
				fullPath: "Archive/2025",
				syncStatus: MailboxSyncStatus.failed,
				pendingPath: "Records/2025",
			},
		]);
		const service = new MailboxSyncService(
			mailboxService,
			specialUseService,
			silentLogger,
		);

		await service.syncMailboxes(
			{ accountId: "acc-1" },
			serverConnection([
				{ fullPath: "INBOX" },
				{ fullPath: "Archive/2025" },
				{ fullPath: "Records/2025" },
			]),
		);

		assert.deepEqual(
			created.map((input) => input.fullPath),
			["INBOX", "Records/2025"],
		);
	});

	it("writes syncStatus synced on the row it discovers", async () => {
		const { mailboxService, specialUseService, created } = buildServices([]);
		const service = new MailboxSyncService(
			mailboxService,
			specialUseService,
			silentLogger,
		);

		await service.syncMailboxes(
			{ accountId: "acc-1" },
			serverConnection([{ fullPath: "INBOX" }]),
		);

		assert.equal(created.length, 1);
		assert.equal(created[0].syncStatus, MailboxSyncStatus.synced);
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
		const service = new MailboxSyncService(
			mailboxService,
			specialUseService,
			silentLogger,
		);

		const result = await service.syncMailboxes(
			{ accountId: "acc-1" },
			serverConnection(),
		);

		assert.deepEqual(deleted, ["synced-gone"]);
		assert.equal(result.deleted, 1);
	});
});

describe("MailboxSyncService.syncMailboxes — a lookalike is not a folder the user keeps mail in (#837)", () => {
	const namespaces: ImapNamespaces = {
		personal: [{ prefix: "", delimiter: "/" }],
		other: [],
		shared: [],
	};

	const serverConnection = (
		folders: Array<{ fullPath: string; attributes: string[] }>,
	): IImapConnection =>
		({
			getNamespaces: async () => namespaces,
			listMailboxes: async () =>
				folders.map((folder) => ({
					fullPath: folder.fullPath,
					name: folder.fullPath.split("/").pop() ?? folder.fullPath,
					delimiter: "/",
					attributes: folder.attributes,
					parentPath: null,
				})),
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
		existing: Array<{ mailboxId: string; fullPath: string }>,
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
					syncStatus: MailboxSyncStatus.synced,
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

	const syncWith = async (
		folders: Array<{ fullPath: string; attributes: string[] }>,
		existing: Array<{ mailboxId: string; fullPath: string }>,
	): Promise<string[]> => {
		const { mailboxService, specialUseService, deleted } =
			buildServices(existing);
		const service = new MailboxSyncService(
			mailboxService,
			specialUseService,
			silentLogger,
		);
		await service.syncMailboxes(
			{ accountId: "acc-1" },
			serverConnection(folders),
		);
		return deleted;
	};

	it("keeps a folder called Deleted beside the folder the server flagged", async () => {
		// `deleted` and `bin` were Trash names in this file's own copy of the hint
		// table long after #843 dropped them from the shared one. Every sync of an
		// account holding a flagged Trash and a user folder called `Deleted` took
		// the user's folder, and its mail, out of the client.
		const deleted = await syncWith(
			[
				{ fullPath: "INBOX", attributes: [] },
				{ fullPath: "Trash", attributes: ["\\Trash"] },
				{ fullPath: "Deleted", attributes: [] },
				{ fullPath: "Bin", attributes: [] },
			],
			[
				{ mailboxId: "inbox", fullPath: "INBOX" },
				{ mailboxId: "trash", fullPath: "Trash" },
				{ mailboxId: "keepsakes", fullPath: "Deleted" },
				{ mailboxId: "bin", fullPath: "Bin" },
			],
		);

		assert.deepEqual(deleted, []);
	});

	it("still hides the unflagged twin of a folder the server flagged", async () => {
		const deleted = await syncWith(
			[
				{ fullPath: "INBOX", attributes: [] },
				{ fullPath: "[Gmail]/Trash", attributes: ["\\Trash"] },
				{ fullPath: "Trash", attributes: [] },
			],
			[
				{ mailboxId: "inbox", fullPath: "INBOX" },
				{ mailboxId: "gmail-trash", fullPath: "[Gmail]/Trash" },
				{ mailboxId: "lookalike", fullPath: "Trash" },
			],
		);

		assert.deepEqual(deleted, ["lookalike"]);
	});

	it("keeps a folder that holds a role of its own", async () => {
		// `all mail` is a conventional name for Archive as well as for All, and the
		// account already has a flagged Archive. The folder holds the All role, so
		// it is a folder in its own right rather than a lookalike of Archive.
		const deleted = await syncWith(
			[
				{ fullPath: "INBOX", attributes: [] },
				{ fullPath: "Archive", attributes: ["\\Archive"] },
				{ fullPath: "INBOX/All Mail", attributes: [] },
			],
			[
				{ mailboxId: "inbox", fullPath: "INBOX" },
				{ mailboxId: "archive", fullPath: "Archive" },
				{ mailboxId: "all-mail", fullPath: "INBOX/All Mail" },
			],
		);

		assert.deepEqual(deleted, []);
	});
});

/**
 * The folder set can also change under a running sweep: a delete asked for while
 * the account is enumerating lands between the LIST and one folder's STATUS.
 * Failing the whole account's enumeration over that one folder stalls every
 * later sync for the account, on a per-account FIFO queue, for the queue's whole
 * visibility window (issue #339).
 */
describe("MailboxSyncService.syncMailboxes — a folder leaving mid-sweep (#339)", () => {
	const namespaces: ImapNamespaces = {
		personal: [{ prefix: "", delimiter: "/" }],
		other: [],
		shared: [],
	};

	const status = () => ({
		messages: 3,
		recent: 0,
		unseen: 0,
		uidNext: 100,
		uidValidity: 1,
		highestModseq: "0",
		deletedCount: 0,
	});

	const buildConnection = (
		statusFor: (path: string) => Promise<ReturnType<typeof status>>,
	): { connection: IImapConnection; statusPaths: string[] } => {
		const statusPaths: string[] = [];
		const connection = {
			getNamespaces: async () => namespaces,
			listMailboxes: async () =>
				["INBOX", "Doomed"].map((fullPath) => ({
					fullPath,
					name: fullPath,
					delimiter: "/",
					attributes: [],
					parentPath: null,
				})),
			getMailboxStatus: async (path: string) => {
				statusPaths.push(path);
				return statusFor(path);
			},
		} as unknown as IImapConnection;
		return { connection, statusPaths };
	};

	const buildServices = (options: {
		doomedSyncStatus?: string;
		getDoomed?: () => Promise<unknown>;
	}) => {
		const updatedIds: string[] = [];
		const row = (mailboxId: string, fullPath: string, syncStatus?: string) => ({
			mailboxId,
			fullPath,
			uidNext: 1,
			uidValidity: 1,
			messageCount: 0,
			unseenCount: 0,
			deletedCount: 0,
			highestModseq: "0",
			specialUse: undefined,
			syncStatus,
		});

		const mailboxService = {
			listByAccount: async () => ({
				items: [
					row("mbx-inbox", "INBOX", MailboxSyncStatus.synced),
					row("mbx-doomed", "Doomed", options.doomedSyncStatus),
				],
				continuationToken: undefined,
			}),
			get: async (_accountId: string, mailboxId: string) => {
				if (mailboxId === "mbx-doomed" && options.getDoomed) {
					return options.getDoomed();
				}
				return row(mailboxId, mailboxId, MailboxSyncStatus.synced);
			},
			update: async (
				_accountId: string,
				mailboxId: string,
				_patch: Record<string, unknown>,
			) => {
				updatedIds.push(mailboxId);
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

		return { mailboxService, specialUseService, updatedIds };
	};

	for (const syncStatus of [
		MailboxSyncStatus.pending,
		MailboxSyncStatus.deleting,
	]) {
		it(`leaves a \`${syncStatus}\` folder untouched — no STATUS, no write`, async () => {
			const { mailboxService, specialUseService, updatedIds } = buildServices({
				doomedSyncStatus: syncStatus,
			});
			const { connection, statusPaths } = buildConnection(async () => status());
			const service = new MailboxSyncService(
				mailboxService,
				specialUseService,
				silentLogger,
			);

			await service.syncMailboxes({ accountId: "acc-1" }, connection);

			assert.deepEqual(statusPaths, ["INBOX"]);
			assert.deepEqual(updatedIds, ["mbx-inbox"]);
		});
	}

	it("finishes the sweep when a folder's STATUS fails and that folder has since been deleted", async () => {
		const { mailboxService, specialUseService, updatedIds } = buildServices({
			doomedSyncStatus: MailboxSyncStatus.synced,
			getDoomed: async () => {
				throw new NotFoundError("Mailbox not found: mbx-doomed");
			},
		});
		const { connection } = buildConnection(async (path) => {
			if (path === "Doomed") throw new Error("Mailbox doesn't exist: Doomed");
			return status();
		});
		const service = new MailboxSyncService(
			mailboxService,
			specialUseService,
			silentLogger,
		);

		await assert.doesNotReject(
			service.syncMailboxes({ accountId: "acc-1" }, connection),
		);
		assert.deepEqual(updatedIds, ["mbx-inbox"]);
	});

	it("fails the sweep when a folder's STATUS fails and the folder is still live", async () => {
		const { mailboxService, specialUseService } = buildServices({
			doomedSyncStatus: MailboxSyncStatus.synced,
			getDoomed: async () => ({
				mailboxId: "mbx-doomed",
				fullPath: "Doomed",
				syncStatus: MailboxSyncStatus.synced,
			}),
		});
		const { connection } = buildConnection(async (path) => {
			if (path === "Doomed") throw new Error("connection reset by peer");
			return status();
		});
		const service = new MailboxSyncService(
			mailboxService,
			specialUseService,
			silentLogger,
		);

		await assert.rejects(
			service.syncMailboxes({ accountId: "acc-1" }, connection),
			/connection reset by peer/,
		);
	});
});
