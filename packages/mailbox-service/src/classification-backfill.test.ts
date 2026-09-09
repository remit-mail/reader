/**
 * Tests for the `backfillClassifications` pass (issue #1197) — the resumable,
 * checkpointed full-corpus pass that classifies rows still carrying the
 * `NotExamined` sentinel on `Message.classificationState`, from their stored
 * bodies, and marks them `Examined`.
 *
 * Mirrors `list-id-backfill.test.ts`: per-account pages, checkpoint after
 * every page, resume by account-id order, and per-message failure
 * containment via `.then(fulfilled, rejected)`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	AccountConfigItem,
	AddressItem,
	IAccountConfigRepository,
	IAddressRepository,
	IMessageRepository,
	IThreadMessageRepository,
	MessageItem,
	ResultList,
	ThreadMessageItem,
	UpdateMessageInput,
	UpdateThreadMessageInput,
} from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import type { StorageService } from "@remit/storage-service";
import { backfillClassifications } from "./classification-backfill.js";

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

const LIST_EML = Buffer.from(
	[
		"From: Alice <alice@example.com>",
		"To: me@example.com",
		"Subject: Newsletter",
		"List-Id: <news.example.com>",
		"List-Unsubscribe: <https://example.com/unsub>",
		"Content-Type: text/plain",
		"",
		"this week in news",
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
		classificationState: "NotExamined",
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
	addressService: Pick<IAddressRepository, "getAddress">;
	threadMessageService: Pick<
		IThreadMessageRepository,
		"listByAccount" | "findAllByMessageId" | "update"
	>;
	messageService: Pick<IMessageRepository, "get" | "update">;
	storageService: Pick<StorageService, "retrieve">;
	messageUpdates: Array<{ messageId: string; input: UpdateMessageInput }>;
	threadUpdates: Array<{
		accountConfigId: string;
		threadMessageId: string;
		input: UpdateThreadMessageInput;
	}>;
	retrieved: string[];
}

const buildHarness = (options: {
	accounts?: AccountConfigItem[];
	rows: ThreadMessageItem[];
	messages: MessageItem[];
	retrieve?: (key: string) => Promise<Buffer>;
	pageSize?: number;
	addressFlags?: AddressItem["flags"];
}): Harness => {
	const accounts = options.accounts ?? [
		{ accountConfigId: "acc-1" } as unknown as AccountConfigItem,
	];
	const messagesById = new Map(options.messages.map((m) => [m.messageId, m]));
	const messageUpdates: Harness["messageUpdates"] = [];
	const threadUpdates: Harness["threadUpdates"] = [];
	const retrieved: string[] = [];
	const pageSize = options.pageSize ?? 200;

	const accountConfigService: Pick<IAccountConfigRepository, "listAll"> = {
		listAll: async () => accounts,
	};

	const addressService = {
		getAddress: (async () => {
			if (options.addressFlags === undefined)
				throw new NotFoundError("no Address row for this sender");
			return { flags: options.addressFlags } as AddressItem;
		}) as unknown as IAddressRepository["getAddress"],
	} as Pick<IAddressRepository, "getAddress">;

	const threadMessageService: Pick<
		IThreadMessageRepository,
		"listByAccount" | "findAllByMessageId" | "update"
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
		findAllByMessageId: async (_accountConfigId, messageId) =>
			options.rows.filter((r) => r.messageId === messageId),
		update: async (accountConfigId, threadMessageId, input) => {
			threadUpdates.push({ accountConfigId, threadMessageId, input });
			const existing = options.rows.find(
				(r) => r.threadMessageId === threadMessageId,
			);
			return { ...existing, ...input } as ThreadMessageItem;
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
		update: async (messageId, input) => {
			messageUpdates.push({ messageId, input });
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

	return {
		accountConfigService,
		addressService,
		threadMessageService,
		messageService,
		storageService,
		messageUpdates,
		threadUpdates,
		retrieved,
	};
};

describe("backfillClassifications", () => {
	it("classifies a NotExamined candidate from its stored body and marks it Examined", async () => {
		const harness = buildHarness({
			rows: [row({ threadMessageId: "tm-1", messageId: "m-1" })],
			messages: [message({ messageId: "m-1" })],
		});

		const result = await backfillClassifications(harness);

		assert.equal(result.backfilled, 1);
		assert.equal(result.failed, 0);
		assert.equal(result.alreadyExamined, 0);
		assert.deepEqual(harness.retrieved, ["s3://m-1"]);
		assert.equal(harness.messageUpdates.length, 1);
		assert.equal(harness.messageUpdates[0].messageId, "m-1");
		// The plain fixture carries no bulk markers, so the header rule table
		// answers `personal`.
		assert.equal(harness.messageUpdates[0].input.category, "personal");
		assert.equal(
			harness.messageUpdates[0].input.classificationState,
			"Examined",
		);
	});

	it("denormalizes the classifier's answer onto the thread row", async () => {
		const harness = buildHarness({
			rows: [row({ threadMessageId: "tm-1", messageId: "m-1" })],
			messages: [message({ messageId: "m-1" })],
		});

		await backfillClassifications(harness);

		// The thread row is written BEFORE the Message update, so a failure
		// between the two leaves both undone for the rerun (issue #320).
		assert.equal(harness.threadUpdates.length, 1);
		assert.equal(harness.threadUpdates[0].threadMessageId, "tm-1");
		assert.equal(harness.threadUpdates[0].input.category, "personal");
	});

	it("writes the derived bulk fields and the row's List-Id, from the same bytes", async () => {
		const harness = buildHarness({
			rows: [row({ threadMessageId: "tm-1", messageId: "m-1" })],
			messages: [message({ messageId: "m-1", bodyStorageKey: "s3://list" })],
			retrieve: async () => LIST_EML,
		});

		const result = await backfillClassifications(harness);

		assert.equal(result.backfilled, 1);
		assert.equal(harness.messageUpdates[0].input.category, "newsletter");
		assert.equal(harness.messageUpdates[0].input.hasListUnsubscribe, true);
		assert.equal(harness.threadUpdates[0].input.listId, "news.example.com");
	});

	it("applies the sender's Address.flags.category override over the header category", async () => {
		const harness = buildHarness({
			rows: [row({ threadMessageId: "tm-1", messageId: "m-1" })],
			messages: [message({ messageId: "m-1" })],
			addressFlags: {
				category: { value: "marketing", setAt: 1 },
			} as AddressItem["flags"],
		});

		const result = await backfillClassifications(harness);

		assert.equal(result.backfilled, 1);
		assert.equal(harness.messageUpdates[0].input.category, "marketing");
		assert.equal(harness.threadUpdates[0].input.category, "marketing");
	});

	it("marks an already-categorized candidate Examined without re-deriving its category", async () => {
		const harness = buildHarness({
			rows: [row({ threadMessageId: "tm-1", messageId: "m-1" })],
			messages: [
				message({
					messageId: "m-1",
					category: "newsletter",
					classificationState: "NotExamined",
				}),
			],
		});

		const result = await backfillClassifications(harness);

		// Those rows were classified by a pass that predates the field; the
		// write-once category is carried forward, never recomputed (#355).
		assert.equal(result.alreadyCategorized, 1);
		assert.equal(result.backfilled, 0);
		assert.deepEqual(harness.retrieved, []);
		assert.equal(harness.messageUpdates.length, 1);
		assert.deepEqual(harness.messageUpdates[0].input, {
			classificationState: "Examined",
		});
		assert.deepEqual(harness.threadUpdates, []);
	});

	it("skips a row already Examined, without reading storage", async () => {
		const harness = buildHarness({
			rows: [row({ threadMessageId: "tm-1", messageId: "m-1" })],
			messages: [
				message({ messageId: "m-1", classificationState: "Examined" }),
			],
		});

		const result = await backfillClassifications(harness);

		assert.equal(result.alreadyExamined, 1);
		assert.equal(result.backfilled, 0);
		assert.deepEqual(harness.retrieved, []);
		assert.deepEqual(harness.messageUpdates, []);
	});

	it("skips a candidate whose body was never synced, without reading storage", async () => {
		const harness = buildHarness({
			rows: [row({ threadMessageId: "tm-1", messageId: "m-1" })],
			messages: [message({ messageId: "m-1", bodyStorageKey: undefined })],
		});

		const result = await backfillClassifications(harness);

		assert.equal(result.skippedNoBody, 1);
		assert.deepEqual(harness.retrieved, []);
		assert.deepEqual(harness.messageUpdates, []);
	});

	it("examines a message once, however many thread rows index it", async () => {
		const harness = buildHarness({
			rows: [
				row({ threadMessageId: "tm-1", messageId: "m-1" }),
				row({
					threadMessageId: "tm-2",
					messageId: "m-1",
					threadId: "thread-2",
				}),
			],
			messages: [message({ messageId: "m-1" })],
		});

		const result = await backfillClassifications(harness);

		assert.equal(result.backfilled, 1);
		assert.equal(result.alreadyExamined, 1);
		assert.deepEqual(harness.retrieved, ["s3://m-1"]);
		assert.equal(harness.messageUpdates.length, 1);
	});

	it("contains a classify failure to the one message and keeps going", async () => {
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
		assert.equal(harness.messageUpdates.length, 1);
		assert.equal(harness.messageUpdates[0].messageId, "m-good");
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
		const progress: Array<{ accountConfigId: string; scanned: number }> = [];

		const result = await backfillClassifications(harness, {
			batchSize: 2,
			onProgress: (p) => progress.push({ ...p }),
		});

		assert.equal(result.backfilled, 3);
		assert.equal(progress.length, 2);
		assert.equal(progress[0].scanned, 2);
		assert.equal(progress[1].scanned, 3);
	});

	it("scans every account returned by listAll, in account-id order", async () => {
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
		const progress: Array<{ accountConfigId: string; scanned: number }> = [];

		const result = await backfillClassifications(harness, {
			onProgress: (p) => progress.push({ ...p }),
		});

		assert.equal(result.backfilled, 3);
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
			harness.messageUpdates.map((u) => u.messageId),
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
			harness.messageUpdates.map((u) => u.messageId),
			["m-0", "m-1", "m-2"],
		);
	});
});
