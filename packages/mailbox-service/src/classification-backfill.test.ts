/**
 * Tests for the `backfillClassifications` pass (issue #1197) — the resumable,
 * checkpointed full-corpus pass that derives `Message.authenticityVerdict`
 * for rows still carrying the `NotEvaluated` sentinel.
 *
 * Mirrors `list-id-backfill.test.ts`: per-account pages, checkpoint after
 * every page, resume by account-id order, and per-message failure
 * containment via `.then(fulfilled, rejected)`.
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
} from "@remit/data-ports";
import type { StorageService } from "@remit/storage-service";
import {
	backfillClassifications,
	type ClassificationBackfillAuthenticityService,
	type ClassificationBackfillProgress,
} from "./classification-backfill.js";
import type { AuthenticityVerdictValue } from "./heuristics/resolveAuthenticityVerdict.js";

const STUB_VERDICT: AuthenticityVerdictValue = "Caution";

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
		bodyStorageKey: "s3://m-1",
		authenticityVerdict: "NotEvaluated",
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	}) as unknown as MessageItem;

const asAccount = (accountConfigId: string): AccountConfigItem =>
	({ accountConfigId }) as unknown as AccountConfigItem;

interface Harness {
	accountConfigService: Pick<IAccountConfigRepository, "listAll">;
	threadMessageService: Pick<IThreadMessageRepository, "listByAccount">;
	messageService: Pick<IMessageRepository, "get" | "update">;
	storageService: Pick<StorageService, "retrieve">;
	authenticityService: ClassificationBackfillAuthenticityService;
	updates: Array<{ messageId: string; verdict: AuthenticityVerdictValue }>;
	retrieved: string[];
	observed: number;
}

const buildHarness = (options: {
	accounts?: AccountConfigItem[];
	rows: ThreadMessageItem[];
	messages: MessageItem[];
	retrieve?: (key: string) => Promise<Buffer>;
	pageSize?: number;
	verdict?: AuthenticityVerdictValue;
}): Harness => {
	const accounts = options.accounts ?? [
		{ accountConfigId: "acc-1" } as unknown as AccountConfigItem,
	];
	const messagesById = new Map(options.messages.map((m) => [m.messageId, m]));
	const updates: Array<{
		messageId: string;
		verdict: AuthenticityVerdictValue;
	}> = [];
	const retrieved: string[] = [];
	const pageSize = options.pageSize ?? 200;
	const verdict = options.verdict ?? STUB_VERDICT;
	const counters = { observed: 0 };

	const accountConfigService: Pick<IAccountConfigRepository, "listAll"> = {
		listAll: async () => accounts,
	};

	const threadMessageService: Pick<IThreadMessageRepository, "listByAccount"> =
		{
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
		};

	const messageService: Pick<IMessageRepository, "get" | "update"> = {
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
		update: async (messageId: string, input) => {
			updates.push({
				messageId,
				verdict: input.authenticityVerdict as AuthenticityVerdictValue,
			});
			const existing = messagesById.get(messageId);
			return { ...existing, ...input } as MessageItem;
		},
	};

	const storageService: Pick<StorageService, "retrieve"> = {
		retrieve: async (key: string) => {
			retrieved.push(key);
			return options.retrieve ? options.retrieve(key) : PLAIN_EML;
		},
	};

	const authenticityService: ClassificationBackfillAuthenticityService = {
		resolveVerdict: async (_accountConfigId, _parsed) => verdict,
		observeStanding: async () => {
			counters.observed++;
		},
	};

	return {
		accountConfigService,
		threadMessageService,
		messageService,
		storageService,
		authenticityService,
		updates,
		retrieved,
		get observed() {
			return counters.observed;
		},
	};
};

describe("backfillClassifications", () => {
	it("writes the derived verdict for a NotEvaluated candidate row", async () => {
		const harness = buildHarness({
			rows: [row({ threadMessageId: "tm-1", messageId: "m-1" })],
			messages: [message({ messageId: "m-1" })],
		});

		const result = await backfillClassifications(harness);

		assert.equal(result.backfilled, 1);
		assert.equal(result.failed, 0);
		assert.equal(result.alreadySet, 0);
		assert.equal(harness.updates.length, 1);
		assert.equal(harness.updates[0].messageId, "m-1");
		assert.equal(harness.updates[0].verdict, STUB_VERDICT);
		assert.equal(harness.observed, 1);
	});

	it("skips a row whose authenticityVerdict is already derived, without reading storage", async () => {
		const harness = buildHarness({
			rows: [row({ threadMessageId: "tm-1", messageId: "m-1" })],
			messages: [message({ messageId: "m-1", authenticityVerdict: "Caution" })],
		});

		const result = await backfillClassifications(harness);

		assert.equal(result.alreadySet, 1);
		assert.equal(result.backfilled, 0);
		assert.deepEqual(harness.retrieved, []);
		assert.deepEqual(harness.updates, []);
		assert.equal(harness.observed, 0);
	});

	it("skips a candidate whose body was never synced, without reading storage", async () => {
		const harness = buildHarness({
			rows: [row({ threadMessageId: "tm-1", messageId: "m-1" })],
			messages: [message({ messageId: "m-1", bodyStorageKey: undefined })],
		});

		const result = await backfillClassifications(harness);

		assert.equal(result.skippedNoBody, 1);
		assert.deepEqual(harness.retrieved, []);
		assert.deepEqual(harness.updates, []);
	});

	it("contains a derive failure to the one message and keeps going", async () => {
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
				return PLAIN_EML;
			},
		});

		const result = await backfillClassifications(harness);

		assert.equal(result.failed, 1);
		assert.deepEqual(result.failedThreadMessageIds, ["tm-bad"]);
		assert.equal(result.backfilled, 1);
		assert.equal(harness.updates.length, 1);
		assert.equal(harness.updates[0].messageId, "m-good");
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
		const progress: ClassificationBackfillProgress[] = [];

		const result = await backfillClassifications(harness, {
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
			messages: [message({ messageId: "m-1" }), message({ messageId: "m-2" })],
		});

		const result = await backfillClassifications(harness);

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
		const progress: ClassificationBackfillProgress[] = [];

		await backfillClassifications(harness, {
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

		const saved: Array<{
			accountConfigId: string;
			continuationToken?: string;
		}> = [];
		let cleared = false;

		await backfillClassifications(harness, {
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

		const result = await backfillClassifications(harness, {
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
			harness.updates.map((u) => u.messageId),
			["m-2"],
		);
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

		const result = await backfillClassifications(harness, {
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
			harness.updates.map((u) => u.messageId),
			["m-0", "m-1", "m-2"],
		);
	});
});
