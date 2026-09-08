import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IMailboxRepository, MailboxItem } from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";
import { MailboxQueueService } from "./mailbox-queue.js";

const row = (mailboxId: string, fullPath: string): MailboxItem =>
	({
		mailboxId,
		accountId: "acc-1",
		fullPath,
		hierarchyDelimiter: "/",
		syncStatus: MailboxSyncStatus.synced,
	}) as MailboxItem;

/**
 * A repository that resolves the subtree and applies `rowSet` the way the real
 * one does, so the paths the intent records are the paths under test.
 */
const store = (rows: MailboxItem[]) => {
	const byId = new Map(rows.map((r) => [r.mailboxId, { ...r }]));

	const repo: Pick<IMailboxRepository, "get" | "transitionSubtree"> = {
		get: (async (_accountId: string, mailboxId: string) => {
			const found = byId.get(mailboxId as string);
			if (!found) {
				throw Object.assign(new Error(`Mailbox not found: ${mailboxId}`), {
					name: "NotFoundError",
				});
			}
			return found;
		}) as IMailboxRepository["get"],
		transitionSubtree: async (_accountId, mailboxId, intent) => {
			const root = byId.get(mailboxId);
			if (!root) return null;
			const prefix = `${root.fullPath}${root.hierarchyDelimiter}`;
			const subtree = [
				root,
				...[...byId.values()].filter(
					(r) => r !== root && r.fullPath.startsWith(prefix),
				),
			];
			const written: MailboxItem[] = [];
			for (const candidate of subtree) {
				if (!intent.from.includes(candidate.syncStatus)) return null;
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
		pathOf: (id: string) => byId.get(id)?.fullPath,
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
	it("records the path the RENAME will carry, `$` patterns and all", async () => {
		// `String.prototype.replace` expands `$&`, "$`", `$'` and `$$` in the
		// replacement, so a folder renamed to a name containing one of them was
		// stored under a different path from the one the event carries to the
		// server. The row and the server then disagree, and the next sweep finds
		// no row for the real path and inserts a second one.
		const { repo, pathOf } = store([
			row("mbx-parent", "Work"),
			row("mbx-child", "Work/2026"),
		]);
		const { service, sent } = queueOver(repo);

		const renamed = await service.renameMailbox(
			"mbx-parent",
			"Q1$&Q2",
			"acc-1",
		);

		assert.equal(renamed.fullPath, "Q1$&Q2");
		assert.equal(pathOf("mbx-parent"), "Q1$&Q2");
		assert.equal(pathOf("mbx-child"), "Q1$&Q2/2026");
		assert.equal(
			(JSON.parse(sent[0]) as { newPath: string }).newPath,
			"Q1$&Q2",
			"the event and the row name the same folder",
		);
	});

	it("moves only what is under the renamed branch", async () => {
		const { repo, pathOf } = store([
			row("mbx-parent", "Work"),
			row("mbx-lookalike", "Workshop"),
		]);
		const { service } = queueOver(repo);

		await service.renameMailbox("mbx-parent", "Projects", "acc-1");

		assert.equal(pathOf("mbx-parent"), "Projects");
		assert.equal(pathOf("mbx-lookalike"), "Workshop");
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
	});
});
