import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ThreadMessageItem } from "@remit/data-ports";
import { MessageCategory, SenderTrust, StarColor } from "@remit/domain-enums";
import {
	buildListThreadMessagesOptions,
	buildListThreadsOptions,
	buildSearchThreadsOptions,
	dedupeThreadMessages,
	executeThreadSearch,
	type ThreadSearchClient,
} from "./thread.js";

const ACCOUNT = "cfg-1";
const MAILBOX = "mbx-inbox";

type Row = {
	threadMessageId: string;
	messageIdHeader?: string;
	createdAt: number;
};

const row = (
	threadMessageId: string,
	messageIdHeader: string | undefined,
	createdAt: number,
): Row => ({ threadMessageId, messageIdHeader, createdAt });

describe("buildListThreadMessagesOptions", () => {
	it("defaults to oldest-first and hides soft-deleted messages", () => {
		assert.deepEqual(buildListThreadMessagesOptions({}), {
			order: "asc",
			excludeDeleted: true,
		});
	});

	it("honours an explicit order", () => {
		assert.equal(
			buildListThreadMessagesOptions({ order: "desc" }).order,
			"desc",
		);
	});

	it("carries no mailbox filter, so sent messages stay in the conversation", () => {
		assert.ok(!("mailboxId" in buildListThreadMessagesOptions({})));
	});
});

describe("dedupeThreadMessages", () => {
	it("keeps a thread whose messages are all distinct", () => {
		const rows = [
			row("tm-1", "<a@example.test>", 10),
			row("tm-2", "<b@example.test>", 20),
		];
		assert.deepEqual(dedupeThreadMessages(rows), rows);
	});

	it("collapses a copied message to the original", () => {
		const original = row("tm-1", "<a@example.test>", 10);
		const copy = row("tm-2", "<a@example.test>", 50);
		assert.deepEqual(dedupeThreadMessages([original, copy]), [original]);
	});

	it("keeps the same row whichever order the rows arrive in", () => {
		const original = row("tm-1", "<a@example.test>", 10);
		const copy = row("tm-2", "<a@example.test>", 50);
		assert.deepEqual(dedupeThreadMessages([copy, original]), [original]);
	});

	it("breaks a createdAt tie on threadMessageId", () => {
		const first = row("tm-a", "<a@example.test>", 10);
		const second = row("tm-b", "<a@example.test>", 10);
		assert.deepEqual(dedupeThreadMessages([second, first]), [first]);
	});

	it("treats headers that differ only by surrounding space as one message", () => {
		const original = row("tm-1", "<a@example.test>", 10);
		const copy = row("tm-2", " <a@example.test> ", 50);
		assert.deepEqual(dedupeThreadMessages([original, copy]), [original]);
	});

	it("never merges rows without a usable header", () => {
		const rows = [
			row("tm-1", undefined, 10),
			row("tm-2", undefined, 20),
			row("tm-3", "<>", 30),
			row("tm-4", "", 40),
		];
		assert.deepEqual(dedupeThreadMessages(rows), rows);
	});

	it("leaves an empty thread empty", () => {
		assert.deepEqual(dedupeThreadMessages([]), []);
	});
});

// #304: `category` is a column on the thread_message row, so it is a SQL
// predicate the port applies inside its window — not a criterion resolved by
// enriching whatever the window happened to return. These assertions are on the
// routing, because that is what a later refactor can silently undo: the SQL
// clause goes dead and the filter falls back to a window-sized filter with no
// test failing.
describe("executeThreadSearch", () => {
	type Category = ThreadMessageItem["category"];

	const threadRow = (
		threadMessageId: string,
		category: Category,
	): ThreadMessageItem => ({
		threadMessageId,
		threadId: `t-${threadMessageId}`,
		messageId: `m-${threadMessageId}`,
		accountConfigId: ACCOUNT,
		mailboxId: MAILBOX,
		uid: 1,
		referenceOrder: 0,
		internalDate: 0,
		sentDate: 0,
		isRead: false,
		hasAttachment: false,
		star: StarColor.None,
		hasStars: false,
		isDeleted: false,
		category,
		createdAt: 0,
		updatedAt: 0,
	});

	type RecordedCall = { search: { category?: Category[] } };

	const fakeClient = (rows: ThreadMessageItem[]) => {
		const windowCalls: RecordedCall[] = [];
		const countCalls: RecordedCall[] = [];

		// The fake applies the category predicate itself, the way a port does, so
		// a request that never reaches `search` cannot answer correctly by
		// accident.
		const matching = (categories?: Category[]) =>
			categories?.length
				? rows.filter((row) => categories.includes(row.category))
				: rows;

		const client: ThreadSearchClient = {
			threadMessage: {
				async searchByMailboxWindow(_account, _mailbox, search) {
					windowCalls.push({ search });
					return {
						items: matching(search.category),
						continuationToken: undefined,
					};
				},
				async countByMailbox(_account, _mailbox, search) {
					countCalls.push({ search });
					return matching(search.category).length;
				},
			},
			message: { get: async () => [] },
			address: { getAddress: async () => [] },
			messageLabel: { listByMessageIds: async () => [] },
			label: { listByAccountConfig: async () => [] },
		};

		return { client, windowCalls, countCalls };
	};

	const ACCOUNT_ROWS = [
		threadRow("tm-1", MessageCategory.personal),
		threadRow("tm-2", MessageCategory.marketing),
		threadRow("tm-3", MessageCategory.uncategorized),
	];

	it("passes category to the port's search, not to the off-row filter", async () => {
		const { client, windowCalls } = fakeClient(ACCOUNT_ROWS);

		const response = await executeThreadSearch(client, ACCOUNT, MAILBOX, {
			category: [MessageCategory.personal],
		});

		assert.deepEqual(windowCalls.length, 1);
		assert.deepEqual(windowCalls[0].search.category, [
			MessageCategory.personal,
		]);
		assert.deepEqual(
			response.items?.map((item) => item.threadMessageId),
			["tm-1"],
		);
	});

	it("takes the count-only path for a category-only query", async () => {
		const { client, windowCalls, countCalls } = fakeClient(ACCOUNT_ROWS);

		const response = await executeThreadSearch(client, ACCOUNT, MAILBOX, {
			category: [MessageCategory.personal, MessageCategory.marketing],
			count: true,
			results: false,
		});

		assert.equal(windowCalls.length, 0, "no window read in count-only mode");
		assert.equal(countCalls.length, 1);
		assert.deepEqual(countCalls[0].search.category, [
			MessageCategory.personal,
			MessageCategory.marketing,
		]);
		assert.equal(response.count, 2);
		assert.equal(response.items, undefined);
	});

	// The one request shape that still takes the off-row branch. `category` must
	// reach `search` anyway, so the window is category-filtered before the
	// enrichment the off-row criterion needs.
	it("keeps category in search when an off-row criterion is also set", async () => {
		const { client, windowCalls } = fakeClient(ACCOUNT_ROWS);

		const response = await executeThreadSearch(client, ACCOUNT, MAILBOX, {
			category: [MessageCategory.personal],
			senderTrust: [SenderTrust.Unknown],
		});

		assert.equal(windowCalls.length, 1);
		assert.deepEqual(windowCalls[0].search.category, [
			MessageCategory.personal,
		]);
		assert.deepEqual(
			response.items?.map((item) => item.threadMessageId),
			["tm-1"],
		);
	});

	it("serves category from the row, so it survives an absent message row", async () => {
		const { client } = fakeClient(ACCOUNT_ROWS);

		const response = await executeThreadSearch(client, ACCOUNT, MAILBOX, {});

		assert.deepEqual(
			response.items?.map((item) => item.category),
			[
				MessageCategory.personal,
				MessageCategory.marketing,
				MessageCategory.uncategorized,
			],
		);
	});

	it("projects category, so the DynamoDB port reads it with the row", () => {
		assert.ok(buildSearchThreadsOptions({}).attributes.includes("category"));
		assert.ok(buildListThreadsOptions({}).attributes.includes("category"));
	});
});
