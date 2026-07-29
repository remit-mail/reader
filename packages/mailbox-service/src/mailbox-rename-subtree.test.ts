import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IMailboxRepository, MailboxItem } from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";
import { MailboxManagementService } from "./mailbox-management.js";
import type { IImapConnection } from "./types.js";

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

const store = (rows: MailboxItem[]) => {
	const byId = new Map(rows.map((r) => [r.mailboxId, { ...r }]));
	const repo = {
		update: async (
			_accountId: string,
			mailboxId: string,
			patch: Partial<MailboxItem>,
		) => {
			const existing = byId.get(mailboxId);
			if (!existing) throw new Error(`Mailbox not found: ${mailboxId}`);
			const next = { ...existing, ...patch };
			byId.set(mailboxId, next);
			return next;
		},
		findByPathPrefix: async (
			_accountId: string,
			pathPrefix: string,
			delimiter = "/",
		) => {
			const prefix = `${pathPrefix}${delimiter}`;
			return [...byId.values()].filter((r) => r.fullPath.startsWith(prefix));
		},
	} as unknown as IMailboxRepository;

	const statusOf = (mailboxId: string) => byId.get(mailboxId)?.syncStatus;
	return { repo, statusOf };
};

const renamingConnection = (): IImapConnection =>
	({
		renameMailbox: async () => undefined,
	}) as unknown as IImapConnection;

/**
 * The local rename writes the new path across the whole subtree and marks every
 * row pending, so a reconcile in the window cannot reap them (#290). These
 * fixtures are that state: the parent and its descendants already at the new
 * path, all pending, waiting for MAILBOX_RENAME to land.
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
			async () => renamingConnection(),
		);

		assert.equal(result.success, true);
		assert.equal(statusOf("mbx-parent"), MailboxSyncStatus.synced);
		assert.equal(statusOf("mbx-child"), MailboxSyncStatus.synced);
		assert.equal(statusOf("mbx-grandchild"), MailboxSyncStatus.synced);
	});

	it("leaves a descendant on its way out or already failed alone", async () => {
		const { repo, statusOf } = store([
			row("mbx-parent", "Projects", MailboxSyncStatus.pending),
			row("mbx-deleting", "Projects/Old", MailboxSyncStatus.deleting),
			row("mbx-failed", "Projects/Broken", MailboxSyncStatus.failed),
			row("mbx-pending", "Projects/2026", MailboxSyncStatus.pending),
		]);
		const service = new MailboxManagementService(repo);

		await service.syncRename(
			"acc-1",
			"mbx-parent",
			"Work",
			"Projects",
			async () => renamingConnection(),
		);

		assert.equal(statusOf("mbx-deleting"), MailboxSyncStatus.deleting);
		assert.equal(statusOf("mbx-failed"), MailboxSyncStatus.failed);
		assert.equal(statusOf("mbx-pending"), MailboxSyncStatus.synced);
	});

	it("settles nothing outside the renamed subtree", async () => {
		const { repo, statusOf } = store([
			row("mbx-parent", "Projects", MailboxSyncStatus.pending),
			row("mbx-lookalike", "Projectsy/2026", MailboxSyncStatus.pending),
			row("mbx-other-rename", "Archive/2026", MailboxSyncStatus.pending),
		]);
		const service = new MailboxManagementService(repo);

		await service.syncRename(
			"acc-1",
			"mbx-parent",
			"Work",
			"Projects",
			async () => renamingConnection(),
		);

		assert.equal(statusOf("mbx-lookalike"), MailboxSyncStatus.pending);
		assert.equal(statusOf("mbx-other-rename"), MailboxSyncStatus.pending);
	});
});
