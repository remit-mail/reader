import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IMailboxRepository, MailboxItem } from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";
import { MailboxManagementService } from "./mailbox-management.js";
import {
	FolderGoneUpstreamError,
	FolderRenameSettleError,
} from "./mailbox-upstream.js";
import type { IImapConnection } from "./types.js";

/**
 * A folder mid-rename: the confirmed path the server still holds, and the
 * target the intent recorded (D2). The settle's row set is exactly the rows
 * carrying such a target, which is what makes it independent of whatever the
 * subtree looks like by the time the RENAME lands (D15).
 */
const renaming = (
	mailboxId: string,
	fullPath: string,
	pendingPath: string,
): MailboxItem =>
	({
		mailboxId,
		accountId: "acc-1",
		fullPath,
		hierarchyDelimiter: "/",
		namespacePrefix: "",
		syncStatus: MailboxSyncStatus.pending,
		pendingPath,
	}) as MailboxItem;

const settled = (
	mailboxId: string,
	fullPath: string,
	syncStatus: MailboxItem["syncStatus"] = MailboxSyncStatus.synced,
): MailboxItem =>
	({
		mailboxId,
		accountId: "acc-1",
		fullPath,
		hierarchyDelimiter: "/",
		namespacePrefix: "",
		syncStatus,
	}) as MailboxItem;

const store = (rows: MailboxItem[], vanishBeforeSettle: string[] = []) => {
	const byId = new Map(rows.map((r) => [r.mailboxId, { ...r }]));

	const repo: Pick<
		IMailboxRepository,
		"get" | "update" | "transition" | "findBySyncStatus"
	> = {
		get: (async (_accountId: string, mailboxId: string) => {
			const found = byId.get(mailboxId as string);
			if (!found) {
				throw Object.assign(new Error(`Mailbox not found: ${mailboxId}`), {
					name: "NotFoundError",
				});
			}
			return found;
		}) as IMailboxRepository["get"],
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
		transition: async (_accountId, mailboxId, intent) => {
			const existing = byId.get(mailboxId);
			if (!existing) return null;
			if (!intent.from.includes(existing.syncStatus)) return null;
			if (
				intent.wherePendingPath !== undefined &&
				(intent.wherePendingPath ?? undefined) !== existing.pendingPath
			) {
				return null;
			}
			const keepsTarget =
				intent.to === MailboxSyncStatus.pending ||
				intent.to === MailboxSyncStatus.failed;
			const next = {
				...existing,
				...(intent.set?.fullPath !== undefined
					? { fullPath: intent.set.fullPath }
					: {}),
				syncStatus: intent.to,
			} as MailboxItem;
			if (!keepsTarget) delete (next as { pendingPath?: string }).pendingPath;
			byId.set(mailboxId, next);
			return next;
		},
		findBySyncStatus: async (_accountId, syncStatus) => {
			const found = [...byId.values()].filter(
				(r) => r.syncStatus === syncStatus,
			);
			for (const mailboxId of vanishBeforeSettle) byId.delete(mailboxId);
			return found;
		},
	};

	return {
		repo: repo as IMailboxRepository,
		rowOf: (mailboxId: string) => byId.get(mailboxId),
	};
};

const connection = (newPath?: string): IImapConnection =>
	({
		renameMailbox: async (_old: string, requested: string) => ({
			path: _old,
			newPath: newPath ?? requested,
		}),
		listMailboxes: async () => [],
	}) as unknown as IImapConnection;

const refusing = (
	error: Error,
	listed: string[] | "unreadable" = [],
): IImapConnection =>
	({
		renameMailbox: async () => {
			throw error;
		},
		listMailboxes: async () => {
			if (listed === "unreadable") throw new Error("IMAP connection lost");
			return listed.map((fullPath) => ({ fullPath, delimiter: "/" }));
		},
	}) as unknown as IImapConnection;

const nonexistent = (): Error =>
	Object.assign(new Error("Command failed"), {
		serverResponseCode: "NONEXISTENT",
		responseText: "Mailbox doesn't exist: Work",
	});

describe("MailboxManagementService.syncRename — settling one intent", () => {
	it("adopts the confirmed path on the folder and every row that carried the intent", async () => {
		const { repo, rowOf } = store([
			renaming("mbx-parent", "Work", "Projects"),
			renaming("mbx-child", "Work/2026", "Projects/2026"),
			renaming("mbx-grandchild", "Work/2026/Q1", "Projects/2026/Q1"),
		]);
		const service = new MailboxManagementService(repo);

		const result = await service.syncRename(
			"acc-1",
			"mbx-parent",
			"Work",
			"Projects",
			async () => connection(),
		);

		assert.equal(result.success, true);
		for (const [id, path] of [
			["mbx-parent", "Projects"],
			["mbx-child", "Projects/2026"],
			["mbx-grandchild", "Projects/2026/Q1"],
		] as const) {
			assert.equal(rowOf(id)?.fullPath, path);
			assert.equal(rowOf(id)?.syncStatus, MailboxSyncStatus.synced);
			assert.equal(rowOf(id)?.pendingPath, undefined);
		}
	});

	it("adopts the path ImapFlow resolved in preference to the requested one", async () => {
		// Not the server echoing a name back — IMAP's RENAME reply carries none.
		// It is ImapFlow's own normalization, with the namespace prefix applied,
		// and adopting it is what stops the row and the server drifting apart.
		const { repo, rowOf } = store([
			renaming("mbx-parent", "Work", "Projects"),
			renaming("mbx-child", "Work/2026", "Projects/2026"),
		]);
		const service = new MailboxManagementService(repo);

		await service.syncRename(
			"acc-1",
			"mbx-parent",
			"Work",
			"Projects",
			async () => connection("INBOX/Projects"),
		);

		assert.equal(rowOf("mbx-parent")?.fullPath, "INBOX/Projects");
		assert.equal(rowOf("mbx-child")?.fullPath, "INBOX/Projects/2026");
	});

	it("leaves a folder the sweep inserted under the branch after the intent alone", async () => {
		// D15: the settle applies to the rows that recorded the intent, and those
		// rows identify themselves. Re-resolving the subtree would either throw —
		// poisoning the account's FIFO group — or leave every row pending forever.
		const { repo, rowOf } = store([
			renaming("mbx-parent", "Work", "Projects"),
			settled("mbx-interloper", "Projects/Fresh"),
		]);
		const service = new MailboxManagementService(repo);

		const result = await service.syncRename(
			"acc-1",
			"mbx-parent",
			"Work",
			"Projects",
			async () => connection(),
		);

		assert.equal(result.success, true);
		assert.equal(rowOf("mbx-parent")?.syncStatus, MailboxSyncStatus.synced);
		assert.equal(rowOf("mbx-interloper")?.fullPath, "Projects/Fresh");
		assert.equal(rowOf("mbx-interloper")?.syncStatus, MailboxSyncStatus.synced);
	});

	it("settles the rest when a descendant is deleted after the intent", async () => {
		const { repo, rowOf } = store(
			[
				renaming("mbx-parent", "Work", "Projects"),
				renaming("mbx-gone", "Work/Gone", "Projects/Gone"),
				renaming("mbx-child", "Work/2026", "Projects/2026"),
			],
			["mbx-gone"],
		);
		const service = new MailboxManagementService(repo);

		const result = await service.syncRename(
			"acc-1",
			"mbx-parent",
			"Work",
			"Projects",
			async () => connection(),
		);

		assert.equal(result.success, true);
		assert.equal(rowOf("mbx-parent")?.fullPath, "Projects");
		assert.equal(rowOf("mbx-child")?.fullPath, "Projects/2026");
	});

	it("does not touch a folder whose own rename is aimed somewhere else", async () => {
		const { repo, rowOf } = store([
			renaming("mbx-parent", "Work", "Projects"),
			renaming("mbx-other", "Admin", "Beheer"),
		]);
		const service = new MailboxManagementService(repo);

		await service.syncRename(
			"acc-1",
			"mbx-parent",
			"Work",
			"Projects",
			async () => connection(),
		);

		assert.equal(rowOf("mbx-other")?.fullPath, "Admin");
		assert.equal(rowOf("mbx-other")?.pendingPath, "Beheer");
		assert.equal(rowOf("mbx-other")?.syncStatus, MailboxSyncStatus.pending);
	});

	it("issues no RENAME when the row has already settled", async () => {
		const { repo } = store([settled("mbx-parent", "Projects")]);
		const service = new MailboxManagementService(repo);
		let issued = 0;

		const result = await service.syncRename(
			"acc-1",
			"mbx-parent",
			"Work",
			"Projects",
			async () =>
				({
					renameMailbox: async () => {
						issued += 1;
						return { path: "Work", newPath: "Projects" };
					},
				}) as unknown as IImapConnection,
		);

		assert.equal(result.success, true);
		assert.equal(issued, 0, "a redelivery must not re-issue the rename");
	});

	it("issues no RENAME when the row is pending for a different target", async () => {
		// A redelivered MAILBOX_RENAME against a folder a second rename has since
		// claimed. `pending` alone passes; the recorded target is what refuses it,
		// and re-issuing from a path that has already moved is what that prevents.
		const { repo, rowOf } = store([renaming("mbx-parent", "Work", "Beheer")]);
		const service = new MailboxManagementService(repo);
		let issued = 0;

		await service.syncRename(
			"acc-1",
			"mbx-parent",
			"Work",
			"Projects",
			async () =>
				({
					renameMailbox: async () => {
						issued += 1;
						return { path: "Work", newPath: "Projects" };
					},
				}) as unknown as IImapConnection,
		);

		assert.equal(issued, 0);
		assert.equal(rowOf("mbx-parent")?.pendingPath, "Beheer");
	});
});

describe("MailboxManagementService.syncRename — rows it must not claim", () => {
	it("leaves a row a different rename recorded under the same branch alone", async () => {
		// Two renames aimed under one path. Matching on the recorded target alone
		// stamps `Other` onto a path this rename never asked for, leaves its own
		// rename with nothing left to settle, and hands the sweep two rows
		// claiming one path to reap and re-insert.
		const { repo, rowOf } = store([
			renaming("mbx-parent", "Work", "Projects"),
			renaming("mbx-other", "Other", "Projects/Old"),
		]);
		const service = new MailboxManagementService(repo);

		await service.syncRename(
			"acc-1",
			"mbx-parent",
			"Work",
			"Projects",
			async () => connection(),
		);

		assert.equal(rowOf("mbx-parent")?.fullPath, "Projects");
		assert.equal(rowOf("mbx-other")?.fullPath, "Other");
		assert.equal(rowOf("mbx-other")?.pendingPath, "Projects/Old");
		assert.equal(rowOf("mbx-other")?.syncStatus, MailboxSyncStatus.pending);
	});

	it("leaves a descendant whose recorded target is not this rename's rebase", async () => {
		const { repo, rowOf } = store([
			renaming("mbx-parent", "Work", "Projects"),
			renaming("mbx-child", "Work/2026", "Projects/Archief"),
		]);
		const service = new MailboxManagementService(repo);

		await service.syncRename(
			"acc-1",
			"mbx-parent",
			"Work",
			"Projects",
			async () => connection(),
		);

		assert.equal(rowOf("mbx-parent")?.fullPath, "Projects");
		assert.equal(rowOf("mbx-child")?.fullPath, "Work/2026");
		assert.equal(rowOf("mbx-child")?.syncStatus, MailboxSyncStatus.pending);
	});

	it("fails only the rows this rename recorded", async () => {
		const { repo, rowOf } = store([
			renaming("mbx-parent", "Work", "Projects"),
			renaming("mbx-other", "Other", "Projects/Old"),
		]);
		const service = new MailboxManagementService(repo);

		await service.failRename("acc-1", "mbx-parent", "Work", "Projects");

		assert.equal(rowOf("mbx-parent")?.syncStatus, MailboxSyncStatus.failed);
		assert.equal(rowOf("mbx-other")?.syncStatus, MailboxSyncStatus.pending);
	});
});

describe("MailboxManagementService.syncRename — a rename that already landed", () => {
	it("settles rather than deleting when NONEXISTENT means the source has moved", async () => {
		// A redelivery after a lost settle re-issues RENAME from a path that has
		// moved. Reading that NONEXISTENT as an upstream delete drops the folder
		// and its mail while the folder is alive at the target.
		const { repo, rowOf } = store([renaming("mbx-parent", "Work", "Projects")]);
		const service = new MailboxManagementService(repo);

		const result = await service.syncRename(
			"acc-1",
			"mbx-parent",
			"Work",
			"Projects",
			async () => refusing(nonexistent(), ["Projects"]),
		);

		assert.equal(result.success, true);
		assert.equal(rowOf("mbx-parent")?.fullPath, "Projects");
		assert.equal(rowOf("mbx-parent")?.syncStatus, MailboxSyncStatus.synced);
	});

	it("reports the folder as gone, carrying what the server said, when neither path is listed", async () => {
		const { repo } = store([renaming("mbx-parent", "Work", "Projects")]);
		const service = new MailboxManagementService(repo);

		await assert.rejects(
			service.syncRename("acc-1", "mbx-parent", "Work", "Projects", async () =>
				refusing(nonexistent(), ["Andere"]),
			),
			(error: unknown) =>
				error instanceof FolderGoneUpstreamError &&
				(error.cause as { serverResponseCode?: string })?.serverResponseCode ===
					"NONEXISTENT",
		);
	});

	it("raises a settle failure as its own kind, never as a refused rename", async () => {
		// The server executed the rename. Marking the rows failed here would offer
		// a retry of work already done, on a `fullPath` the server no longer holds.
		const { repo, rowOf } = store([renaming("mbx-parent", "Work", "Projects")]);
		const broken = {
			...repo,
			transition: async () => {
				throw new Error("database is locked");
			},
		} as unknown as IMailboxRepository;
		const service = new MailboxManagementService(broken);

		await assert.rejects(
			service.syncRename("acc-1", "mbx-parent", "Work", "Projects", async () =>
				connection(),
			),
			(error: unknown) => error instanceof FolderRenameSettleError,
		);

		assert.equal(rowOf("mbx-parent")?.syncStatus, MailboxSyncStatus.pending);
		assert.equal(
			rowOf("mbx-parent")?.pendingPath,
			"Projects",
			"the intent stands, so the redelivery finishes the settle",
		);
	});
});

describe("MailboxManagementService.syncRename — a settle that dies part-way", () => {
	/**
	 * The named folder's row is the redelivery's only witness: the guard reads
	 * it and nothing else. Settling it before its descendants would ack a run
	 * that stopped half way, and those rows would stay `pending` forever —
	 * skipped by message sync, and with no route out, because an intent may only
	 * be recorded from `synced` or `failed`.
	 */
	it("leaves the named folder carrying the intent when a descendant's write fails", async () => {
		const { repo, rowOf } = store([
			renaming("mbx-parent", "Work", "Projects"),
			renaming("mbx-child", "Work/2026", "Projects/2026"),
		]);
		let broken = true;
		const flaky = {
			...repo,
			transition: async (
				accountId: string,
				mailboxId: string,
				intent: Parameters<IMailboxRepository["transition"]>[2],
			) => {
				if (broken && mailboxId === "mbx-child") {
					throw new Error("database is locked");
				}
				return repo.transition(accountId, mailboxId, intent);
			},
		} as unknown as IMailboxRepository;
		const service = new MailboxManagementService(flaky);

		await assert.rejects(
			service.syncRename("acc-1", "mbx-parent", "Work", "Projects", async () =>
				connection(),
			),
			(error: unknown) => error instanceof FolderRenameSettleError,
		);

		assert.equal(rowOf("mbx-parent")?.syncStatus, MailboxSyncStatus.pending);
		assert.equal(rowOf("mbx-parent")?.pendingPath, "Projects");
		assert.equal(rowOf("mbx-child")?.syncStatus, MailboxSyncStatus.pending);

		// The redelivery re-enters against an intent still standing and finishes.
		broken = false;
		const redelivered = new MailboxManagementService(flaky);
		const result = await redelivered.syncRename(
			"acc-1",
			"mbx-parent",
			"Work",
			"Projects",
			async () => connection(),
		);

		assert.equal(result.success, true);
		assert.equal(rowOf("mbx-parent")?.fullPath, "Projects");
		assert.equal(rowOf("mbx-child")?.fullPath, "Projects/2026");
		assert.equal(rowOf("mbx-child")?.syncStatus, MailboxSyncStatus.synced);
	});
});

describe("MailboxManagementService.syncRename — reading NONEXISTENT", () => {
	const prefixed = (): MailboxItem =>
		({
			mailboxId: "mbx-parent",
			accountId: "acc-1",
			fullPath: "Work",
			hierarchyDelimiter: ".",
			namespacePrefix: "INBOX.",
			syncStatus: MailboxSyncStatus.pending,
			pendingPath: "Projects",
		}) as MailboxItem;

	it("reads the target through the account's namespace prefix", async () => {
		// The requested string and the path the server keeps are not the same:
		// a Dovecot INBOX namespace stores `Projects` as `INBOX.Projects`.
		// Comparing the raw request against the listing reads a folder that is
		// plainly there as absent — and that answer deletes the user's mail.
		const { repo, rowOf } = store([prefixed()]);
		const service = new MailboxManagementService(repo);

		const result = await service.syncRename(
			"acc-1",
			"mbx-parent",
			"Work",
			"Projects",
			async () => refusing(nonexistent(), ["INBOX.Projects"]),
		);

		assert.equal(result.success, true);
		assert.equal(rowOf("mbx-parent")?.syncStatus, MailboxSyncStatus.synced);
	});

	it("raises the confirmed kind only when the listing holds neither path", async () => {
		const { repo } = store([renaming("mbx-parent", "Work", "Projects")]);
		const service = new MailboxManagementService(repo);

		await assert.rejects(
			service.syncRename("acc-1", "mbx-parent", "Work", "Projects", async () =>
				refusing(nonexistent(), ["Andere"]),
			),
			(error: unknown) => error instanceof FolderGoneUpstreamError,
		);
	});

	it("refuses the rename rather than confirming a delete when the source is still listed", async () => {
		const { repo } = store([renaming("mbx-parent", "Work", "Projects")]);
		const service = new MailboxManagementService(repo);

		await assert.rejects(
			service.syncRename("acc-1", "mbx-parent", "Work", "Projects", async () =>
				refusing(nonexistent(), ["Work"]),
			),
			(error: unknown) =>
				!(error instanceof FolderGoneUpstreamError) &&
				(error as { serverResponseCode?: string }).serverResponseCode ===
					"NONEXISTENT",
		);
	});

	it("refuses the rename when the listing cannot be read at all", async () => {
		// A probe that answers nothing decides nothing. A refused rename costs a
		// retry; reading an unclear answer as a delete costs the folder's mail.
		const { repo } = store([renaming("mbx-parent", "Work", "Projects")]);
		const service = new MailboxManagementService(repo);

		await assert.rejects(
			service.syncRename("acc-1", "mbx-parent", "Work", "Projects", async () =>
				refusing(nonexistent(), "unreadable"),
			),
			(error: unknown) => !(error instanceof FolderGoneUpstreamError),
		);
	});
});

describe("MailboxManagementService.failRename", () => {
	it("marks every intent-carrying row failed, keeping its path and its target", async () => {
		const { repo, rowOf } = store([
			renaming("mbx-parent", "Work", "Projects"),
			renaming("mbx-child", "Work/2026", "Projects/2026"),
		]);
		const service = new MailboxManagementService(repo);

		await service.failRename("acc-1", "mbx-parent", "Work", "Projects");

		for (const [id, path, target] of [
			["mbx-parent", "Work", "Projects"],
			["mbx-child", "Work/2026", "Projects/2026"],
		] as const) {
			assert.equal(rowOf(id)?.syncStatus, MailboxSyncStatus.failed);
			assert.equal(rowOf(id)?.fullPath, path, "nothing is restored (D2)");
			assert.equal(
				rowOf(id)?.pendingPath,
				target,
				"the target is kept so the client can name it and offer a retry",
			);
		}
	});

	it("raises a NotFoundError when the folder row itself is gone", async () => {
		const { repo } = store([]);
		const service = new MailboxManagementService(repo);

		await assert.rejects(
			service.failRename("acc-1", "mbx-parent", "Work", "Projects"),
			(error: unknown) => (error as Error).name === "NotFoundError",
		);
	});

	it("records nothing, quietly, when the row is there but carries no intent", async () => {
		// Never a NotFoundError: the caller reads that as the user having deleted
		// the folder and acks the message, which would swallow the IMAP failure
		// that brought us here and leave the subtree `pending` with no retry.
		const { repo } = store([settled("mbx-parent", "Work")]);
		const service = new MailboxManagementService(repo);

		await assert.doesNotReject(
			service.failRename("acc-1", "mbx-parent", "Work", "Projects"),
		);
	});

	it("settles a rename ImapFlow never issued as a refusal, not a TypeError", async () => {
		// `mailboxRename` resolves `undefined` when the connection is not
		// AUTHENTICATED or SELECTED. The settle reads the resolved path, so an
		// unguarded dereference would raise a TypeError the rename cannot classify.
		const { repo, rowOf } = store([renaming("mbx-parent", "Work", "Projects")]);
		const service = new MailboxManagementService(repo);
		const notReady = new Error(
			'Rename of "Work" was not issued: the IMAP connection is not ready',
		);

		await assert.rejects(
			service.syncRename("acc-1", "mbx-parent", "Work", "Projects", async () =>
				refusing(notReady),
			),
			/not ready/,
		);

		await service.failRename("acc-1", "mbx-parent", "Work", "Projects");
		assert.equal(rowOf("mbx-parent")?.syncStatus, MailboxSyncStatus.failed);
		assert.equal(rowOf("mbx-parent")?.fullPath, "Work");
	});
});
