import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IMailboxRepository, MailboxItem } from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";
import { MailboxQueueService } from "./mailbox-queue.js";

const row = (
	mailboxId: string,
	fullPath: string,
	over: Partial<MailboxItem> = {},
): MailboxItem =>
	({
		mailboxId,
		accountId: "acc-1",
		fullPath,
		hierarchyDelimiter: "/",
		syncStatus: MailboxSyncStatus.synced,
		...over,
	}) as MailboxItem;

/**
 * A repository that resolves the subtree and applies `rowSet` the way the real
 * one does, so the paths the intent records are the paths under test.
 */
const store = (rows: MailboxItem[]) => {
	const byId = new Map(rows.map((r) => [r.mailboxId, { ...r }]));
	const subtreeOf = (root: MailboxItem) => {
		const prefix = `${root.fullPath}${root.hierarchyDelimiter}`;
		return [...byId.values()].filter(
			(r) => r.mailboxId !== root.mailboxId && r.fullPath.startsWith(prefix),
		);
	};

	const repo: Pick<
		IMailboxRepository,
		| "get"
		| "transition"
		| "transitionSubtree"
		| "findByPathPrefix"
		| "findBySyncStatus"
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
		findByPathPrefix: async (_accountId, pathPrefix) => {
			const root = [...byId.values()].find((r) => r.fullPath === pathPrefix);
			return root ? subtreeOf(root) : [];
		},
		findBySyncStatus: async (_accountId, syncStatus) =>
			[...byId.values()].filter((r) => r.syncStatus === syncStatus),
		transition: async (_accountId, mailboxId, intent) => {
			const current = byId.get(mailboxId);
			if (!current) return null;
			if (!intent.from.includes(current.syncStatus)) return null;
			if (
				intent.wherePendingPath !== undefined &&
				(intent.wherePendingPath ?? undefined) !== current.pendingPath
			) {
				return null;
			}
			const keepsTarget =
				intent.to === MailboxSyncStatus.pending ||
				intent.to === MailboxSyncStatus.failed;
			const next = {
				...current,
				...(intent.set?.fullPath !== undefined
					? { fullPath: intent.set.fullPath }
					: {}),
				syncStatus: intent.to,
			} as MailboxItem;
			if (!keepsTarget) delete (next as { pendingPath?: string }).pendingPath;
			byId.set(mailboxId, next);
			return next;
		},
		transitionSubtree: async (_accountId, mailboxId, intent) => {
			const root = byId.get(mailboxId);
			if (!root) return null;
			const subtree = [root, ...subtreeOf(root)];
			// All-or-nothing, the way the real transaction is: one row that is not
			// in an accepted from-state refuses the whole intent and writes nothing.
			if (subtree.some((c) => !intent.from.includes(c.syncStatus))) return null;
			const written: MailboxItem[] = [];
			for (const candidate of subtree) {
				const next = {
					...candidate,
					...intent.rowSet(candidate),
					syncStatus: intent.to,
				} as MailboxItem;
				byId.set(candidate.mailboxId, next);
				written.push(next);
			}
			// The port promises no ordering beyond "the named folder first", so
			// hand the caller the least convenient order it is allowed to return.
			return written.reverse();
		},
	};

	return {
		repo: repo as IMailboxRepository,
		rowOf: (id: string) => byId.get(id),
	};
};

const queueOver = (repo: IMailboxRepository) => {
	const sent: string[] = [];
	const service = new MailboxQueueService({
		mailboxService: repo,
		sqsQueueUrl: "http://localhost:4566/000000000000/mailbox",
	});
	(
		service as unknown as {
			sqs: {
				send: (command: { input: { MessageBody: string } }) => Promise<void>;
			};
		}
	).sqs = {
		send: async (command) => {
			sent.push(command.input.MessageBody);
		},
	};
	return { service, sent };
};

describe("MailboxQueueService.renameMailbox — the recorded intent", () => {
	it("records the target and leaves every confirmed path alone", async () => {
		// D2: `fullPath` is always a path the server holds. Writing the target onto
		// the row is what made a failed rename strand a subtree at paths the server
		// never had, which the next sweep then inserted second rows for.
		const { repo, rowOf } = store([
			row("mbx-parent", "Work"),
			row("mbx-child", "Work/2026"),
		]);
		const { service } = queueOver(repo);

		await service.renameMailbox("mbx-parent", "Projects", "acc-1");

		assert.equal(rowOf("mbx-parent")?.fullPath, "Work");
		assert.equal(rowOf("mbx-parent")?.pendingPath, "Projects");
		assert.equal(rowOf("mbx-child")?.fullPath, "Work/2026");
		assert.equal(rowOf("mbx-child")?.pendingPath, "Projects/2026");
		assert.equal(rowOf("mbx-child")?.syncStatus, MailboxSyncStatus.pending);
	});

	it("records the path the RENAME will carry, `$` patterns and all", async () => {
		// `String.prototype.replace` expands `$&`, "$`", `$'` and `$$` in the
		// replacement, so a folder renamed to a name containing one of them was
		// stored under a different path from the one the event carries to the
		// server. The row and the server then disagree.
		const { repo, rowOf } = store([
			row("mbx-parent", "Work"),
			row("mbx-child", "Work/2026"),
		]);
		const { service, sent } = queueOver(repo);

		await service.renameMailbox("mbx-parent", "Q1$&Q2", "acc-1");

		assert.equal(rowOf("mbx-parent")?.pendingPath, "Q1$&Q2");
		assert.equal(rowOf("mbx-child")?.pendingPath, "Q1$&Q2/2026");
		assert.equal(
			(JSON.parse(sent[0]) as { newPath: string }).newPath,
			"Q1$&Q2",
			"the event and the row name the same folder",
		);
	});

	it("moves only what is under the renamed branch", async () => {
		const { repo, rowOf } = store([
			row("mbx-parent", "Work"),
			row("mbx-lookalike", "Workshop"),
		]);
		const { service } = queueOver(repo);

		await service.renameMailbox("mbx-parent", "Projects", "acc-1");

		assert.equal(rowOf("mbx-parent")?.pendingPath, "Projects");
		assert.equal(rowOf("mbx-lookalike")?.pendingPath, undefined);
		assert.equal(rowOf("mbx-lookalike")?.syncStatus, MailboxSyncStatus.synced);
	});

	it("returns the folder that was asked for, not whichever row came back first", async () => {
		const { repo } = store([
			row("mbx-parent", "Work"),
			row("mbx-child", "Work/2026"),
		]);
		const { service } = queueOver(repo);

		const renamed = await service.renameMailbox(
			"mbx-parent",
			"Projects",
			"acc-1",
		);

		assert.equal(renamed.mailboxId, "mbx-parent");
		assert.equal(renamed.pendingPath, "Projects");
	});

	it("records a retry from a failed rename onto the same row", async () => {
		const { repo, rowOf } = store([
			row("mbx-parent", "Work", {
				syncStatus: MailboxSyncStatus.failed,
				pendingPath: "Projects",
			}),
		]);
		const { service } = queueOver(repo);

		await service.renameMailbox("mbx-parent", "Projects", "acc-1");

		assert.equal(rowOf("mbx-parent")?.syncStatus, MailboxSyncStatus.pending);
		assert.equal(rowOf("mbx-parent")?.pendingPath, "Projects");
	});

	it("refuses the whole subtree with a 409 naming the descendant that blocks it", async () => {
		// A subtree cannot be half-renamed (D6), so a descendant mid-mutation
		// refuses the rename of everything above it — and the user has to be told
		// which folder, because it is not the one they named.
		const { repo, rowOf } = store([
			row("mbx-parent", "Archive"),
			row("mbx-child", "Archive/2025/Receipts", {
				syncStatus: MailboxSyncStatus.pending,
				pendingPath: "Archive/2025/Bonnen",
			}),
		]);
		const { service, sent } = queueOver(repo);

		await assert.rejects(
			service.renameMailbox("mbx-parent", "Archief", "acc-1"),
			(error: unknown) =>
				(error as { statusCode?: number }).statusCode === 409 &&
				(error as Error).message ===
					'A rename is in progress for "Archive/2025/Receipts", inside this folder.',
		);

		assert.equal(rowOf("mbx-parent")?.syncStatus, MailboxSyncStatus.synced);
		assert.equal(rowOf("mbx-parent")?.pendingPath, undefined);
		assert.equal(sent.length, 0, "nothing is enqueued for a refused intent");
	});

	it("refuses with a 409 naming the folder's own delete when it is the blocker", async () => {
		const { repo } = store([
			row("mbx-parent", "Archive", {
				syncStatus: MailboxSyncStatus.deleting,
			}),
		]);
		const { service } = queueOver(repo);

		await assert.rejects(
			service.renameMailbox("mbx-parent", "Archief", "acc-1"),
			(error: unknown) =>
				(error as { statusCode?: number }).statusCode === 409 &&
				(error as Error).message ===
					'A delete is already in progress for "Archive".',
		);
	});

	it("answers 404 when the folder went between the read and the intent", async () => {
		const { repo } = store([row("mbx-parent", "Work")]);
		let read = 0;
		// The read that establishes existence sees the row; the classifying read
		// on the lost predicate does not, so the answer is 404, not a conflict.
		const vanishing = {
			...repo,
			get: (async (accountId: string, mailboxId: string) => {
				read += 1;
				if (read > 1) {
					throw Object.assign(new Error(`Mailbox not found: ${mailboxId}`), {
						name: "NotFoundError",
					});
				}
				return repo.get(accountId, mailboxId as string);
			}) as IMailboxRepository["get"],
			transitionSubtree: async () => null,
		} as IMailboxRepository;
		const { service } = queueOver(vanishing);

		await assert.rejects(
			service.renameMailbox("mbx-parent", "Projects", "acc-1"),
			(error: unknown) => (error as Error).name === "NotFoundError",
		);
	});
});

describe("MailboxQueueService.dismissMailboxIntent", () => {
	it("clears a failed rename's target and settles the row, enqueuing nothing", async () => {
		const { repo, rowOf } = store([
			row("mbx-1", "Work", {
				syncStatus: MailboxSyncStatus.failed,
				pendingPath: "Projects",
			}),
		]);
		const { service, sent } = queueOver(repo);

		const dismissed = await service.dismissMailboxIntent("mbx-1", "acc-1");

		assert.equal(dismissed.syncStatus, MailboxSyncStatus.synced);
		assert.equal(rowOf("mbx-1")?.pendingPath, undefined);
		assert.equal(rowOf("mbx-1")?.fullPath, "Work");
		assert.equal(sent.length, 0);
	});

	it("clears the whole subtree the failed rename was recorded over", async () => {
		// The refusal marks every row the intent recorded, so dismissing the named
		// folder alone leaves each descendant `failed` with a stale target on it,
		// offering a retry of a rename the user has already dropped and with
		// nothing left that would ever clear it.
		const { repo, rowOf } = store([
			row("mbx-parent", "Work", {
				syncStatus: MailboxSyncStatus.failed,
				pendingPath: "Projects",
			}),
			row("mbx-child", "Work/2026", {
				syncStatus: MailboxSyncStatus.failed,
				pendingPath: "Projects/2026",
			}),
		]);
		const { service } = queueOver(repo);

		await service.dismissMailboxIntent("mbx-parent", "acc-1");

		for (const id of ["mbx-parent", "mbx-child"]) {
			assert.equal(rowOf(id)?.syncStatus, MailboxSyncStatus.synced);
			assert.equal(rowOf(id)?.pendingPath, undefined);
		}
	});

	it("leaves a failed folder a different rename recorded alone", async () => {
		const { repo, rowOf } = store([
			row("mbx-parent", "Work", {
				syncStatus: MailboxSyncStatus.failed,
				pendingPath: "Projects",
			}),
			row("mbx-other", "Other", {
				syncStatus: MailboxSyncStatus.failed,
				pendingPath: "Projects/Old",
			}),
		]);
		const { service } = queueOver(repo);

		await service.dismissMailboxIntent("mbx-parent", "acc-1");

		assert.equal(rowOf("mbx-other")?.syncStatus, MailboxSyncStatus.failed);
		assert.equal(rowOf("mbx-other")?.pendingPath, "Projects/Old");
	});

	it("dismisses a failed delete on the named folder alone", async () => {
		// No recorded target, so there is no subtree the intent was written over.
		const { repo, rowOf } = store([
			row("mbx-parent", "Work", { syncStatus: MailboxSyncStatus.failed }),
			row("mbx-child", "Work/2026", { syncStatus: MailboxSyncStatus.failed }),
		]);
		const { service } = queueOver(repo);

		await service.dismissMailboxIntent("mbx-parent", "acc-1");

		assert.equal(rowOf("mbx-parent")?.syncStatus, MailboxSyncStatus.synced);
		assert.equal(rowOf("mbx-child")?.syncStatus, MailboxSyncStatus.failed);
	});

	it("is a no-op on a folder with nothing to dismiss", async () => {
		const { repo } = store([row("mbx-1", "Work")]);
		const { service } = queueOver(repo);

		const dismissed = await service.dismissMailboxIntent("mbx-1", "acc-1");

		assert.equal(dismissed.syncStatus, MailboxSyncStatus.synced);
	});

	it("refuses with a 409 while a mutation is still in flight", async () => {
		const { repo } = store([
			row("mbx-1", "Work", {
				syncStatus: MailboxSyncStatus.pending,
				pendingPath: "Projects",
			}),
		]);
		const { service } = queueOver(repo);

		await assert.rejects(
			service.dismissMailboxIntent("mbx-1", "acc-1"),
			(error: unknown) =>
				(error as { statusCode?: number }).statusCode === 409 &&
				(error as Error).message === 'A rename is in progress for "Work".',
		);
	});
});
