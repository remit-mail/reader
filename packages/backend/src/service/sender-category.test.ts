import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	ThreadMessageFieldTerm,
	ThreadMessageItem,
	UpdateMessageInput,
	UpdateThreadMessageInput,
} from "@remit/data-ports";
import {
	backApplySenderCategory,
	SENDER_CATEGORY_BACKAPPLY_LIMIT,
	type SenderCategoryBackApplyDeps,
} from "./sender-category.js";

const ACCOUNT_CONFIG_ID = "cfg-415";
const SENDER = "post@ns.nl";

const row = (n: number, over: Partial<ThreadMessageItem> = {}) =>
	({
		threadMessageId: `tm-${n}`,
		threadId: `th-${n}`,
		messageId: `msg-${n}`,
		accountConfigId: ACCOUNT_CONFIG_ID,
		mailboxId: "mbx-inbox",
		fromEmail: SENDER,
		fromName: "NS Reizigers",
		subject: `reisoverzicht ${n}`,
		category: "personal",
		sentDate: 2_000 - n,
		isRead: false,
		isDeleted: false,
		hasStars: false,
		hasAttachment: false,
		...over,
	}) as unknown as ThreadMessageItem;

interface Writes {
	messages: Array<{ messageId: string; input: UpdateMessageInput }>;
	threadRows: Array<{
		threadMessageId: string;
		input: UpdateThreadMessageInput;
	}>;
	terms: ThreadMessageFieldTerm[][];
	pageSizes: Array<number | undefined>;
}

/**
 * A store that pages its rows the way the real listing does — newest first,
 * `limit` rows per page, a continuation token while more remain — and that
 * answers `findAllByMessageId` from the same rows, so a re-label is provably
 * written to both halves of the pair.
 */
const storeOf = (
	rows: ThreadMessageItem[],
	writes: Writes,
): SenderCategoryBackApplyDeps => ({
	client: {
		message: {
			update: async (messageId: string, input: UpdateMessageInput) => {
				writes.messages.push({ messageId, input });
				return {} as never;
			},
		},
		threadMessage: {
			listByFieldTerms: async (
				_accountConfigId: string,
				terms: readonly ThreadMessageFieldTerm[],
				options?: { limit?: number; continuationToken?: string },
			) => {
				writes.terms.push([...terms]);
				writes.pageSizes.push(options?.limit);
				const from = Number(options?.continuationToken ?? 0);
				const size = options?.limit ?? rows.length;
				const page = rows.slice(from, from + size);
				const next = from + page.length;
				return {
					items: page,
					continuationToken: next < rows.length ? String(next) : undefined,
				};
			},
			findAllByMessageId: async (_accountConfigId: string, messageId: string) =>
				rows.filter((r) => r.messageId === messageId),
			update: async (
				_accountConfigId: string,
				threadMessageId: string,
				input: UpdateThreadMessageInput,
			) => {
				writes.threadRows.push({ threadMessageId, input });
				return {} as never;
			},
		},
	} as unknown as SenderCategoryBackApplyDeps["client"],
});

const emptyWrites = (): Writes => ({
	messages: [],
	threadRows: [],
	terms: [],
	pageSizes: [],
});

describe("backApplySenderCategory (#415)", () => {
	it("re-labels mail the classifier already decided, on both halves of the pair", async () => {
		const writes = emptyWrites();
		const rows = [row(1), row(2), row(3)];

		const result = await backApplySenderCategory(
			storeOf(rows, writes),
			ACCOUNT_CONFIG_ID,
			SENDER,
			"newsletter",
		);

		assert.deepEqual(result, { matched: 3, applied: 3, failed: 0 });
		assert.deepEqual(
			writes.messages.map((w) => w.messageId),
			["msg-1", "msg-2", "msg-3"],
		);
		assert.deepEqual(
			writes.messages.map((w) => w.input.category),
			["newsletter", "newsletter", "newsletter"],
		);
		assert.deepEqual(
			writes.threadRows.map((w) => w.threadMessageId),
			["tm-1", "tm-2", "tm-3"],
		);
		assert.deepEqual(
			writes.threadRows.map((w) => w.input.category),
			["newsletter", "newsletter", "newsletter"],
		);
	});

	it("stops at the bound, keeping the newest of the sender's mail", async () => {
		const writes = emptyWrites();
		const rows = Array.from(
			{ length: SENDER_CATEGORY_BACKAPPLY_LIMIT + 25 },
			(_, i) => row(i + 1),
		);

		const result = await backApplySenderCategory(
			storeOf(rows, writes),
			ACCOUNT_CONFIG_ID,
			SENDER,
			"newsletter",
		);

		assert.equal(result.matched, SENDER_CATEGORY_BACKAPPLY_LIMIT);
		assert.equal(result.applied, SENDER_CATEGORY_BACKAPPLY_LIMIT);
		assert.equal(writes.messages.length, SENDER_CATEGORY_BACKAPPLY_LIMIT);
		assert.equal(writes.messages[0]?.messageId, "msg-1");
		assert.equal(
			writes.messages.at(-1)?.messageId,
			`msg-${SENDER_CATEGORY_BACKAPPLY_LIMIT}`,
		);
	});

	it("refines the store's substring narrowing to an exact sender match", async () => {
		const writes = emptyWrites();
		const rows = [
			row(1),
			row(2, { messageId: "msg-lookalike", fromEmail: "no-post@ns.nl" }),
			row(3, { messageId: "msg-name-only", fromEmail: "spoof@example.com" }),
		];

		const result = await backApplySenderCategory(
			storeOf(rows, writes),
			ACCOUNT_CONFIG_ID,
			SENDER,
			"newsletter",
		);

		assert.equal(result.matched, 1);
		assert.deepEqual(
			writes.messages.map((w) => w.messageId),
			["msg-1"],
		);
		assert.deepEqual(writes.terms[0], [{ field: "sender", contains: SENDER }]);
	});

	it("pages the narrowed listing until the bound fills", async () => {
		const writes = emptyWrites();
		const rows = Array.from({ length: 12 }, (_, i) =>
			i % 2 === 0
				? row(i + 1)
				: row(i + 1, {
						messageId: `msg-other-${i}`,
						fromEmail: "someone@example.com",
					}),
		);

		const result = await backApplySenderCategory(
			storeOf(rows, writes),
			ACCOUNT_CONFIG_ID,
			SENDER,
			"newsletter",
			4,
		);

		assert.equal(result.matched, 4);
		assert.ok(
			writes.terms.length > 1,
			"a page of narrowed rows that yields fewer matches than the bound must be followed by the next page",
		);
		assert.deepEqual(writes.pageSizes, Array(writes.terms.length).fill(4));
	});

	it("counts a poisoned message as failed and re-labels the rest", async () => {
		const writes = emptyWrites();
		const rows = [row(1), row(2), row(3)];
		const store = storeOf(rows, writes);
		const threadMessage = store.client.threadMessage as unknown as Record<
			string,
			unknown
		>;
		const findAll = threadMessage.findAllByMessageId as (
			a: string,
			b: string,
		) => Promise<ThreadMessageItem[]>;
		threadMessage.findAllByMessageId = async (a: string, b: string) =>
			b === "msg-2" ? [] : findAll(a, b);

		const result = await backApplySenderCategory(
			store,
			ACCOUNT_CONFIG_ID,
			SENDER,
			"newsletter",
		);

		assert.deepEqual(result, { matched: 3, applied: 2, failed: 1 });
		assert.deepEqual(
			writes.messages.map((w) => w.messageId),
			["msg-1", "msg-3"],
		);
	});
});
