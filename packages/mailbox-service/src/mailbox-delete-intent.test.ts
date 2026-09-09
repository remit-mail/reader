import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IMailboxRepository, MailboxItem } from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";
import { MailboxManagementService } from "./mailbox-management.js";
import { MailboxQueueService } from "./mailbox-queue.js";
import type { IImapConnection } from "./types.js";

const row = (over: Partial<MailboxItem> = {}): MailboxItem =>
	({
		mailboxId: "mbx-1",
		accountId: "acc-1",
		fullPath: "Receipts",
		hierarchyDelimiter: "/",
		syncStatus: MailboxSyncStatus.synced,
		...over,
	}) as MailboxItem;

const store = (rows: MailboxItem[]) => {
	const byId = new Map(rows.map((r) => [r.mailboxId, { ...r }]));
	const removed: string[] = [];

	const repo: Pick<
		IMailboxRepository,
		"get" | "transition" | "findByPathPrefix" | "deleteMailboxWithMail"
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
		findByPathPrefix: async () => [],
		transition: async (_accountId, mailboxId, intent) => {
			const current = byId.get(mailboxId);
			if (!current) return null;
			if (!intent.from.includes(current.syncStatus)) return null;
			const next = { ...current, syncStatus: intent.to } as MailboxItem;
			byId.set(mailboxId, next);
			return next;
		},
		deleteMailboxWithMail: async (_accountId, mailboxId) => {
			removed.push(mailboxId);
			byId.delete(mailboxId);
		},
	};

	return { repo: repo as IMailboxRepository, byId, removed };
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

describe("MailboxQueueService.deleteMailbox — the recorded intent", () => {
	it("records `deleting` and enqueues one DELETE", async () => {
		const { repo, byId } = store([row()]);
		const { service, sent } = queueOver(repo);

		await service.deleteMailbox("mbx-1", "acc-1");

		assert.equal(byId.get("mbx-1")?.syncStatus, MailboxSyncStatus.deleting);
		assert.equal(sent.length, 1);
		assert.equal(
			(JSON.parse(sent[0]) as { path: string }).path,
			"Receipts",
			"the event names the path the server holds",
		);
	});

	it("accepts a retry from a failed delete", async () => {
		const { repo, byId } = store([
			row({ syncStatus: MailboxSyncStatus.failed }),
		]);
		const { service, sent } = queueOver(repo);

		await service.deleteMailbox("mbx-1", "acc-1");

		assert.equal(byId.get("mbx-1")?.syncStatus, MailboxSyncStatus.deleting);
		assert.equal(sent.length, 1);
	});

	it("gives the loser a 409 naming the delete already in flight", async () => {
		const { repo } = store([row({ syncStatus: MailboxSyncStatus.deleting })]);
		const { service, sent } = queueOver(repo);

		await assert.rejects(
			service.deleteMailbox("mbx-1", "acc-1"),
			(error: unknown) =>
				(error as { statusCode?: number }).statusCode === 409 &&
				(error as Error).message ===
					'A delete is already in progress for "Receipts".',
		);
		assert.equal(sent.length, 0, "the loser enqueues nothing");
	});

	it("gives the loser a 409 naming a rename in flight", async () => {
		const { repo } = store([
			row({
				syncStatus: MailboxSyncStatus.pending,
				pendingPath: "Bonnen",
			}),
		]);
		const { service } = queueOver(repo);

		await assert.rejects(
			service.deleteMailbox("mbx-1", "acc-1"),
			(error: unknown) =>
				(error as Error).message === 'A rename is in progress for "Receipts".',
		);
	});
});

describe("MailboxManagementService.syncDelete — settling the intent", () => {
	const deleting = () =>
		store([row({ syncStatus: MailboxSyncStatus.deleting })]);

	const connection = (calls: string[]): IImapConnection =>
		({
			deleteMailbox: async (path: string) => {
				calls.push(path);
				return { path };
			},
		}) as unknown as IImapConnection;

	it("takes the folder's mail with it, not the row alone", async () => {
		// Removing the row alone leaves every message and thread_message row keyed
		// to a dead mailboxId — out of every reader, and still in the search index
		// because nothing writes the `message.removed` outbox event (D8).
		const { repo, removed, byId } = deleting();
		const service = new MailboxManagementService(repo);
		const calls: string[] = [];

		const result = await service.syncDelete(
			"acc-1",
			"mbx-1",
			"Receipts",
			async () => connection(calls),
		);

		assert.equal(result.success, true);
		assert.deepEqual(calls, ["Receipts"]);
		assert.deepEqual(removed, ["mbx-1"]);
		assert.equal(byId.has("mbx-1"), false);
	});

	it("issues no DELETE when the row is not deleting", async () => {
		const { repo, removed } = store([row()]);
		const service = new MailboxManagementService(repo);
		const calls: string[] = [];

		const result = await service.syncDelete(
			"acc-1",
			"mbx-1",
			"Receipts",
			async () => connection(calls),
		);

		assert.equal(result.success, true);
		assert.deepEqual(calls, [], "the connection is never asked");
		assert.deepEqual(removed, []);
	});

	it("resolves when the row is already gone", async () => {
		const { repo } = store([]);
		const service = new MailboxManagementService(repo);
		const calls: string[] = [];

		const result = await service.syncDelete(
			"acc-1",
			"mbx-1",
			"Receipts",
			async () => connection(calls),
		);

		assert.equal(result.success, true);
		assert.deepEqual(calls, []);
	});

	it("resumes an interrupted removal on a redelivery", async () => {
		// The row stays `deleting` until the final commit, so a redelivery
		// re-enters, passes the guard and continues where it stopped.
		const { repo, removed } = deleting();
		const service = new MailboxManagementService(repo);
		const calls: string[] = [];

		await service.settleDelete("acc-1", "mbx-1");
		const result = await service.syncDelete(
			"acc-1",
			"mbx-1",
			"Receipts",
			async () => connection(calls),
		);

		assert.equal(result.success, true);
		assert.deepEqual(calls, [], "no second IMAP DELETE is issued");
		assert.deepEqual(removed, ["mbx-1"]);
	});
});

describe("MailboxManagementService.failDelete", () => {
	it("marks the row failed, unwinding nothing", async () => {
		// DELETE is all-or-nothing, so fullPath is still what the server holds,
		// and no rename target is written — which is how the client tells a failed
		// delete from a failed rename (T9).
		const { repo, byId } = store([
			row({ syncStatus: MailboxSyncStatus.deleting }),
		]);
		const service = new MailboxManagementService(repo);

		await service.failDelete("acc-1", "mbx-1");

		assert.equal(byId.get("mbx-1")?.syncStatus, MailboxSyncStatus.failed);
		assert.equal(byId.get("mbx-1")?.fullPath, "Receipts");
		assert.equal(byId.get("mbx-1")?.pendingPath, undefined);
	});

	it("raises a NotFoundError when the row is gone", async () => {
		const { repo } = store([]);
		const service = new MailboxManagementService(repo);

		await assert.rejects(
			service.failDelete("acc-1", "mbx-1"),
			(error: unknown) => (error as Error).name === "NotFoundError",
		);
	});
});
