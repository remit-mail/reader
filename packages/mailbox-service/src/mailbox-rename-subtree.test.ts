import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IMailboxRepository, MailboxItem } from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";
import { MailboxManagementService } from "./mailbox-management.js";
import type { FlatMailboxInfo, IImapConnection } from "./types.js";

const row = (
	mailboxId: string,
	fullPath: string,
	syncStatus: MailboxItem["syncStatus"],
): MailboxItem =>
	({
		mailboxId,
		accountId: "acc-1",
		fullPath,
		hierarchyDelimiter: "/",
		syncStatus,
	}) as MailboxItem;

const store = (rows: MailboxItem[], vanishAfterSweep: string[] = []) => {
	const byId = new Map(rows.map((r) => [r.mailboxId, { ...r }]));

	const repo: Pick<IMailboxRepository, "update" | "findByPathPrefix"> = {
		update: async (_accountId, mailboxId, patch) => {
			const existing = byId.get(mailboxId);
			if (!existing) {
				throw Object.assign(new Error(`Mailbox not found: ${mailboxId}`), {
					name: "NotFoundError",
				});
			}
			const next = { ...existing, ...patch } as MailboxItem;
			byId.set(mailboxId, next);
			return next;
		},
		findByPathPrefix: async (_accountId, pathPrefix, delimiter = "/") => {
			const prefix = `${pathPrefix}${delimiter}`;
			const found = [...byId.values()].filter((r) =>
				r.fullPath.startsWith(prefix),
			);
			for (const mailboxId of vanishAfterSweep) byId.delete(mailboxId);
			return found;
		},
	};

	return {
		repo: repo as IMailboxRepository,
		statusOf: (mailboxId: string) => byId.get(mailboxId)?.syncStatus,
	};
};

const connectionListing = (paths: string[]): IImapConnection =>
	({
		renameMailbox: async () => undefined,
		listMailboxes: async (): Promise<FlatMailboxInfo[]> =>
			paths.map((fullPath) => ({
				fullPath,
				name: fullPath.split("/").pop() ?? fullPath,
				delimiter: "/",
				attributes: [],
				parentPath: null,
			})),
	}) as unknown as IImapConnection;

/**
 * The local rename writes the new path across the whole subtree and marks every
 * row pending, so a reconcile in that window cannot reap them (#290). These
 * fixtures are that state at the moment the worker picks the event up: the
 * parent and its descendants already carry their new paths.
 */
describe("MailboxManagementService.syncRename — subtree settle", () => {
	it("settles every descendant the rename carried, not just the renamed row", async () => {
		const { repo, statusOf } = store([
			row("mbx-parent", "Projects", MailboxSyncStatus.pending),
			row("mbx-child", "Projects/2026", MailboxSyncStatus.pending),
			row("mbx-grandchild", "Projects/2026/Q1", MailboxSyncStatus.pending),
		]);
		const service = new MailboxManagementService(repo);

		const result = await service.syncRename(
			"acc-1",
			"mbx-parent",
			"Work",
			"Projects",
			async () =>
				connectionListing(["Projects", "Projects/2026", "Projects/2026/Q1"]),
		);

		assert.equal(result.success, true);
		assert.equal(statusOf("mbx-parent"), MailboxSyncStatus.synced);
		assert.equal(statusOf("mbx-child"), MailboxSyncStatus.synced);
		assert.equal(statusOf("mbx-grandchild"), MailboxSyncStatus.synced);
	});

	it("leaves a descendant behind a rename of its own pending", async () => {
		// Two renames in one per-account FIFO group: `Projects` → `Work` moves the
		// child row to `Work/2026`, then `Work/2026` → `Work/Archive` moves it
		// again before the first RENAME is worked. When the first one lands the
		// server holds `Work/2026`; `Work/Archive` exists only locally, and
		// stripping its pending marker would let the reconcile sweep reap the row
		// and rebuild it under a fresh mailboxId, dangling every filter bound to
		// the old one.
		const { repo, statusOf } = store([
			row("mbx-parent", "Work", MailboxSyncStatus.pending),
			row("mbx-child", "Work/Archive", MailboxSyncStatus.pending),
		]);
		const service = new MailboxManagementService(repo);

		await service.syncRename(
			"acc-1",
			"mbx-parent",
			"Projects",
			"Work",
			async () => connectionListing(["Work", "Work/2026"]),
		);

		assert.equal(statusOf("mbx-parent"), MailboxSyncStatus.synced);
		assert.equal(statusOf("mbx-child"), MailboxSyncStatus.pending);
	});

	it("leaves a descendant the user has asked to delete on its way out", async () => {
		// A delete requested after the local rename wrote the subtree pending: the
		// folder is still on the server, and settling it would undo the request.
		const { repo, statusOf } = store([
			row("mbx-parent", "Projects", MailboxSyncStatus.pending),
			row("mbx-deleting", "Projects/Old", MailboxSyncStatus.deleting),
			row("mbx-child", "Projects/2026", MailboxSyncStatus.pending),
		]);
		const service = new MailboxManagementService(repo);

		await service.syncRename(
			"acc-1",
			"mbx-parent",
			"Work",
			"Projects",
			async () =>
				connectionListing(["Projects", "Projects/Old", "Projects/2026"]),
		);

		assert.equal(statusOf("mbx-deleting"), MailboxSyncStatus.deleting);
		assert.equal(statusOf("mbx-child"), MailboxSyncStatus.synced);
	});

	it("settles inside the renamed subtree without reaching a lookalike sibling", async () => {
		const { repo, statusOf } = store([
			row("mbx-parent", "Projects", MailboxSyncStatus.pending),
			row("mbx-child", "Projects/2026", MailboxSyncStatus.pending),
			row("mbx-lookalike", "Projectsy/2026", MailboxSyncStatus.pending),
		]);
		const service = new MailboxManagementService(repo);

		await service.syncRename(
			"acc-1",
			"mbx-parent",
			"Work",
			"Projects",
			async () =>
				connectionListing(["Projects", "Projects/2026", "Projectsy/2026"]),
		);

		assert.equal(statusOf("mbx-child"), MailboxSyncStatus.synced);
		assert.equal(statusOf("mbx-lookalike"), MailboxSyncStatus.pending);
	});

	it("reports the rename as done when a descendant row vanishes mid-settle", async () => {
		// The settle is repair work, not the mutation. A descendant deleted while
		// it runs has nothing left to settle, and must not roll a completed server
		// rename back to failed — the handler's catch treats any throw from here
		// as an IMAP failure and restores the old path.
		const { repo, statusOf } = store(
			[
				row("mbx-parent", "Projects", MailboxSyncStatus.pending),
				row("mbx-gone", "Projects/Gone", MailboxSyncStatus.pending),
				row("mbx-child", "Projects/2026", MailboxSyncStatus.pending),
			],
			["mbx-gone"],
		);
		const service = new MailboxManagementService(repo);

		const result = await service.syncRename(
			"acc-1",
			"mbx-parent",
			"Work",
			"Projects",
			async () =>
				connectionListing(["Projects", "Projects/Gone", "Projects/2026"]),
		);

		assert.equal(result.success, true);
		assert.equal(statusOf("mbx-child"), MailboxSyncStatus.synced);
	});
});
