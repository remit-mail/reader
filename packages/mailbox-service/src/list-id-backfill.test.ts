/**
 * ListId is only written at body-sync time, going forward (issue #263). A row
 * synced before header extraction shipped keeps `listId` unset forever, so a
 * `ListId` filter clause silently under-matches the back catalogue.
 *
 * These tests pin the one-time, resumable pass that closes that gap: it reads
 * each candidate's already-stored raw source (never IMAP), extracts
 * `List-Id`, and writes only that field.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	AccountConfigItem,
	IAccountConfigRepository,
	IMessageRepository,
	IThreadMessageRepository,
	MessageItem,
	ResultList,
	ThreadMessageItem,
	UpdateThreadMessageInput,
} from "@remit/data-ports";
import type { StorageService } from "@remit/storage-service";
import {
	backfillListIds,
	type ListIdBackfillCheckpoint,
	type ListIdBackfillCheckpointStore,
	type ListIdBackfillProgress,
} from "./list-id-backfill.js";

const LIST_EML = Buffer.from(
	[
		"From: Weekly News <news@example.com>",
		"To: me@example.com",
		"Subject: This week",
		"List-Id: Weekly News <weekly.news.example.com>",
		"Content-Type: text/plain",
		"",
		"news",
	].join("\r\n"),
);

const PLAIN_EML = Buffer.from(
	[
		"From: Alice <alice@example.com>",
		"To: me@example.com",
		"Subject: Hi",
		"Content-Type: text/plain",
		"",
		"hi",
	].join("\r\n"),
);

const MALFORMED_LIST_ID_EML = Buffer.from(
	[
		"From: Weird <weird@example.com>",
		"To: me@example.com",
		"Subject: Odd header",
		"List-Id:",
		"Content-Type: text/plain",
		"",
		"body",
	].join("\r\n"),
);

const row = (overrides: Partial<ThreadMessageItem>): ThreadMessageItem =>
	({
		threadMessageId: "tm-1",
		accountConfigId: "acc-1",
		threadId: "thread-1",
		messageId: "m-1",
		mailboxId: "mb-1",
		uid: 1,
		referenceOrder: 0,
		internalDate: 1,
		sentDate: 1,
		isRead: false,
		hasAttachment: false,
		star: "none",
		hasStars: false,
		isDeleted: false,
		category: "uncategorized",
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	}) as unknown as ThreadMessageItem;

const message = (overrides: Partial<MessageItem>): MessageItem =>
	({
		messageId: "m-1",
		mailboxId: "mb-1",
		uid: 1,
		status: "active",
		syncStatus: "synced",
		category: "uncategorized",
		hasListUnsubscribe: false,
		movedByRemit: false,
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	}) as unknown as MessageItem;

const asAccount = (accountConfigId: string): AccountConfigItem =>
	({ accountConfigId }) as unknown as AccountConfigItem;

const inMemoryCheckpointStore = (): ListIdBackfillCheckpointStore => {
	let checkpoint: ListIdBackfillCheckpoint | undefined;
	return {
		load: async () => checkpoint,
		save: async (next) => {
			checkpoint = next;
		},
		clear: async () => {
			checkpoint = undefined;
		},
	};
};

interface Harness {
	accountConfigService: Pick<IAccountConfigRepository, "listAll">;
	threadMessageService: Pick<
		IThreadMessageRepository,
		"listByAccount" | "update"
	>;
	messageService: Pick<IMessageRepository, "get">;
	storageService: Pick<StorageService, "retrieve">;
	updates: Array<{ threadMessageId: string; input: UpdateThreadMessageInput }>;
	retrieved: string[];
}

const buildHarness = (options: {
	accounts?: AccountConfigItem[];
	rows: ThreadMessageItem[];
	messages: MessageItem[];
	retrieve?: (key: string) => Promise<Buffer>;
	pageSize?: number;
}): Harness => {
	const accounts = options.accounts ?? [
		{ accountConfigId: "acc-1" } as unknown as AccountConfigItem,
	];
	const messagesById = new Map(options.messages.map((m) => [m.messageId, m]));
	const updates: Array<{
		threadMessageId: string;
		input: UpdateThreadMessageInput;
	}> = [];
	const retrieved: string[] = [];
	const pageSize = options.pageSize ?? 200;

	const accountConfigService: Pick<IAccountConfigRepository, "listAll"> = {
		listAll: async () => accounts,
	};

	const threadMessageService: Pick<
		IThreadMessageRepository,
		"listByAccount" | "update"
	> = {
		listByAccount: async (
			accountConfigId: string,
			opts?: { limit?: number; continuationToken?: string },
		): Promise<ResultList<ThreadMessageItem>> => {
			const scoped = options.rows.filter(
				(r) => r.accountConfigId === accountConfigId,
			);
			const start = opts?.continuationToken
				? Number(opts.continuationToken)
				: 0;
			const limit = opts?.limit ?? pageSize;
			const page = scoped.slice(start, start + limit);
			const nextStart = start + page.length;
			return {
				items: page,
				continuationToken:
					nextStart < scoped.length ? String(nextStart) : undefined,
			};
		},
		update: async (
			_accountConfigId: string,
			threadMessageId: string,
			input: UpdateThreadMessageInput,
		) => {
			updates.push({ threadMessageId, input });
			return row({ threadMessageId, ...input });
		},
	};

	const messageService: Pick<IMessageRepository, "get"> = {
		get: (async (messageIds: string | string[]) => {
			if (Array.isArray(messageIds)) {
				return messageIds
					.map((id) => messagesById.get(id))
					.filter((m): m is MessageItem => m !== undefined);
			}
			const found = messagesById.get(messageIds);
			if (!found) throw new Error(`no fixture for ${messageIds}`);
			return found;
		}) as IMessageRepository["get"],
	};

	const storageService: Pick<StorageService, "retrieve"> = {
		retrieve: async (key: string) => {
			retrieved.push(key);
			return options.retrieve ? options.retrieve(key) : LIST_EML;
		},
	};

	return {
		accountConfigService,
		threadMessageService,
		messageService,
		storageService,
		updates,
		retrieved,
	};
};

describe("backfillListIds", () => {
	it("writes the extracted List-Id for a candidate row", async () => {
		const harness = buildHarness({
			rows: [row({ threadMessageId: "tm-1", messageId: "m-1" })],
			messages: [message({ messageId: "m-1", bodyStorageKey: "s3://m-1" })],
		});

		const result = await backfillListIds(harness);

		assert.equal(result.backfilled, 1);
		assert.equal(result.failed, 0);
		assert.equal(harness.updates.length, 1);
		assert.equal(harness.updates[0].input.listId, "weekly.news.example.com");
	});

	it("leaves listId empty, without error, when the message has no List-Id header", async () => {
		const harness = buildHarness({
			rows: [row({ threadMessageId: "tm-1", messageId: "m-1" })],
			messages: [message({ messageId: "m-1", bodyStorageKey: "s3://m-1" })],
			retrieve: async () => PLAIN_EML,
		});

		const result = await backfillListIds(harness);

		assert.equal(result.noListId, 1);
		assert.equal(result.failed, 0);
		assert.deepEqual(harness.updates, []);
	});

	it("does not error on a malformed List-Id header", async () => {
		const harness = buildHarness({
			rows: [row({ threadMessageId: "tm-1", messageId: "m-1" })],
			messages: [message({ messageId: "m-1", bodyStorageKey: "s3://m-1" })],
			retrieve: async () => MALFORMED_LIST_ID_EML,
		});

		const result = await backfillListIds(harness);

		assert.equal(result.failed, 0);
		assert.equal(result.noListId, 1);
		assert.deepEqual(harness.updates, []);
	});

	it("skips a row whose listId is already set, without reading storage", async () => {
		const harness = buildHarness({
			rows: [
				row({
					threadMessageId: "tm-1",
					messageId: "m-1",
					listId: "already.set",
				}),
			],
			messages: [message({ messageId: "m-1", bodyStorageKey: "s3://m-1" })],
		});

		const result = await backfillListIds(harness);

		assert.equal(result.alreadySet, 1);
		assert.equal(result.backfilled, 0);
		assert.deepEqual(harness.retrieved, []);
		assert.deepEqual(harness.updates, []);
	});

	it("skips a candidate whose body was never synced, without reading storage", async () => {
		const harness = buildHarness({
			rows: [row({ threadMessageId: "tm-1", messageId: "m-1" })],
			messages: [message({ messageId: "m-1", bodyStorageKey: undefined })],
		});

		const result = await backfillListIds(harness);

		assert.equal(result.skippedNoBody, 1);
		assert.deepEqual(harness.retrieved, []);
		assert.deepEqual(harness.updates, []);
	});

	it("contains a storage failure to the one message and keeps going", async () => {
		const harness = buildHarness({
			rows: [
				row({ threadMessageId: "tm-bad", messageId: "m-bad" }),
				row({ threadMessageId: "tm-good", messageId: "m-good" }),
			],
			messages: [
				message({ messageId: "m-bad", bodyStorageKey: "s3://m-bad" }),
				message({ messageId: "m-good", bodyStorageKey: "s3://m-good" }),
			],
			retrieve: async (key) => {
				if (key === "s3://m-bad") throw new Error("AccessDenied");
				return LIST_EML;
			},
		});

		const result = await backfillListIds(harness);

		assert.equal(result.failed, 1);
		assert.deepEqual(result.failedThreadMessageIds, ["tm-bad"]);
		assert.equal(result.backfilled, 1);
		assert.equal(harness.updates.length, 1);
		assert.equal(harness.updates[0].threadMessageId, "tm-good");
	});

	it("reports progress as pages are processed", async () => {
		const rows = Array.from({ length: 3 }, (_, i) =>
			row({ threadMessageId: `tm-${i}`, messageId: `m-${i}` }),
		);
		const messages = rows.map((r) =>
			message({
				messageId: r.messageId,
				bodyStorageKey: `s3://${r.messageId}`,
			}),
		);
		const harness = buildHarness({ rows, messages, pageSize: 2 });
		const progress: ListIdBackfillProgress[] = [];

		const result = await backfillListIds(harness, {
			batchSize: 2,
			onProgress: (p) => progress.push({ ...p }),
		});

		assert.equal(result.backfilled, 3);
		assert.equal(progress.length, 2);
		assert.equal(progress[0].scanned, 2);
		assert.equal(progress[1].scanned, 3);
	});

	it("scans every account returned by listAll", async () => {
		const harness = buildHarness({
			accounts: [
				{ accountConfigId: "acc-1" } as unknown as AccountConfigItem,
				{ accountConfigId: "acc-2" } as unknown as AccountConfigItem,
			],
			rows: [
				row({
					threadMessageId: "tm-1",
					messageId: "m-1",
					accountConfigId: "acc-1",
				}),
				row({
					threadMessageId: "tm-2",
					messageId: "m-2",
					accountConfigId: "acc-2",
				}),
			],
			messages: [
				message({ messageId: "m-1", bodyStorageKey: "s3://m-1" }),
				message({ messageId: "m-2", bodyStorageKey: "s3://m-2" }),
			],
		});

		const result = await backfillListIds(harness);

		assert.equal(result.backfilled, 2);
		assert.equal(harness.updates.length, 2);
	});

	it("scans accounts in account-id order, whatever order listAll returns", async () => {
		const accountIds = ["acc-1", "acc-2", "acc-3"];
		const rows = accountIds.map((accountConfigId) =>
			row({
				threadMessageId: `tm-${accountConfigId}`,
				messageId: `m-${accountConfigId}`,
				accountConfigId,
			}),
		);
		const harness = buildHarness({
			accounts: ["acc-3", "acc-1", "acc-2"].map(asAccount),
			rows,
			messages: rows.map((r) =>
				message({
					messageId: r.messageId,
					bodyStorageKey: `s3://${r.messageId}`,
				}),
			),
		});
		const progress: ListIdBackfillProgress[] = [];

		await backfillListIds(harness, {
			onProgress: (p) => progress.push({ ...p }),
		});

		assert.deepEqual(
			progress.map((p) => p.accountConfigId),
			accountIds,
		);
	});

	it("checkpoints after each page and clears it on completion", async () => {
		const rows = Array.from({ length: 3 }, (_, i) =>
			row({ threadMessageId: `tm-${i}`, messageId: `m-${i}` }),
		);
		const messages = rows.map((r) =>
			message({
				messageId: r.messageId,
				bodyStorageKey: `s3://${r.messageId}`,
			}),
		);
		const harness = buildHarness({ rows, messages, pageSize: 2 });

		const saved: ListIdBackfillCheckpoint[] = [];
		let cleared = false;

		await backfillListIds(harness, {
			batchSize: 2,
			checkpointStore: {
				load: async () => undefined,
				save: async (checkpoint) => {
					saved.push(checkpoint);
				},
				clear: async () => {
					cleared = true;
				},
			},
		});

		assert.equal(saved.length, 2);
		assert.equal(saved[0].accountConfigId, "acc-1");
		assert.equal(saved[0].continuationToken, "2");
		assert.equal(saved[1].continuationToken, undefined);
		assert.equal(cleared, true);
	});

	it("resumes from a saved checkpoint instead of rescanning from the start", async () => {
		const rows = Array.from({ length: 3 }, (_, i) =>
			row({ threadMessageId: `tm-${i}`, messageId: `m-${i}` }),
		);
		const messages = rows.map((r) =>
			message({
				messageId: r.messageId,
				bodyStorageKey: `s3://${r.messageId}`,
			}),
		);
		const harness = buildHarness({ rows, messages, pageSize: 2 });

		const result = await backfillListIds(harness, {
			batchSize: 2,
			checkpointStore: {
				load: async () => ({
					accountConfigId: "acc-1",
					continuationToken: "2",
				}),
				save: async () => {},
				clear: async () => {},
			},
		});

		assert.equal(result.scanned, 1);
		assert.equal(result.backfilled, 1);
		assert.deepEqual(
			harness.updates.map((u) => u.threadMessageId),
			["tm-2"],
		);
	});

	it("resumes the account it was working through after an earlier account is removed", async () => {
		const accountIds = ["acc-1", "acc-2", "acc-3"];
		const rows = [
			row({
				threadMessageId: "tm-1",
				messageId: "m-1",
				accountConfigId: "acc-1",
			}),
			row({
				threadMessageId: "tm-2a",
				messageId: "m-2a",
				accountConfigId: "acc-2",
			}),
			row({
				threadMessageId: "tm-2b",
				messageId: "m-2b",
				accountConfigId: "acc-2",
			}),
			row({
				threadMessageId: "tm-3",
				messageId: "m-3",
				accountConfigId: "acc-3",
			}),
		];
		const messages = rows.map((r) =>
			message({
				messageId: r.messageId,
				bodyStorageKey: `s3://${r.messageId}`,
			}),
		);

		const store = inMemoryCheckpointStore();

		const interrupted = buildHarness({
			accounts: accountIds.map(asAccount),
			rows,
			messages,
			pageSize: 1,
		});
		const listByAccount = interrupted.threadMessageService.listByAccount;
		interrupted.threadMessageService.listByAccount = async (
			accountConfigId,
			opts,
		) => {
			if (accountConfigId === "acc-2" && opts?.continuationToken) {
				throw new Error("interrupted");
			}
			return listByAccount(accountConfigId, opts);
		};

		await assert.rejects(
			backfillListIds(interrupted, { batchSize: 1, checkpointStore: store }),
			/interrupted/,
		);

		const resumed = buildHarness({
			accounts: ["acc-2", "acc-3"].map(asAccount),
			rows,
			messages,
			pageSize: 1,
		});

		const result = await backfillListIds(resumed, {
			batchSize: 1,
			checkpointStore: store,
		});

		assert.deepEqual(
			resumed.updates.map((u) => u.threadMessageId),
			["tm-2b", "tm-3"],
		);
		assert.equal(result.backfilled, 2);
	});

	it("restarts the pass when the checkpointed account no longer exists", async () => {
		const rows = Array.from({ length: 3 }, (_, i) =>
			row({ threadMessageId: `tm-${i}`, messageId: `m-${i}` }),
		);
		const messages = rows.map((r) =>
			message({
				messageId: r.messageId,
				bodyStorageKey: `s3://${r.messageId}`,
			}),
		);
		const harness = buildHarness({ rows, messages, pageSize: 2 });

		const result = await backfillListIds(harness, {
			batchSize: 2,
			checkpointStore: {
				load: async () => ({
					accountConfigId: "acc-removed",
					continuationToken: "2",
				}),
				save: async () => {},
				clear: async () => {},
			},
		});

		assert.equal(result.scanned, 3);
		assert.deepEqual(
			harness.updates.map((u) => u.threadMessageId),
			["tm-0", "tm-1", "tm-2"],
		);
	});
});
