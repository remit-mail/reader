import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	AccountItem,
	MailboxItem,
	ThreadMessageItem,
} from "@remit/data-ports";
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

const ownership = {
	account: {
		listMailSourcesByAccountConfig: async () =>
			[{ accountId: "account-1" }] as AccountItem[],
	},
	mailbox: {
		get: async (accountId: string, mailboxIds: string[]) =>
			mailboxIds.map((mailboxId) => ({
				mailboxId,
				accountId,
			})) as MailboxItem[],
	},
};

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

	type RecordedCall = {
		search: Parameters<
			ThreadSearchClient["threadMessage"]["searchByMailboxWindow"]
		>[2];
		continuationToken?: string;
		limit?: number;
	};

	const fakeClient = (rows: ThreadMessageItem[]) => {
		const windowCalls: RecordedCall[] = [];
		const countCalls: RecordedCall[] = [];

		// The fake applies the category predicate itself, the way a port does, so
		// a request that never reaches `search` cannot answer correctly by
		// accident. The window also honours `limit`, so a handler deriving a count
		// from the rows it got back cannot pass for one that asked the port.
		const matching = (categories?: Category[]) =>
			categories?.length
				? rows.filter((row) => categories.includes(row.category))
				: rows;

		const client: ThreadSearchClient = {
			threadMessage: {
				async searchByMailboxWindow(_account, _mailbox, search, options) {
					windowCalls.push({
						search,
						continuationToken: options?.continuationToken,
						limit: options?.limit,
					});
					return {
						items: matching(search.category).slice(0, options?.limit),
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
			...ownership,
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

	it("passes senderTrust and dkimMismatch to the port's search", async () => {
		const { client, windowCalls } = fakeClient(ACCOUNT_ROWS);

		const response = await executeThreadSearch(client, ACCOUNT, MAILBOX, {
			category: [MessageCategory.personal],
			senderTrust: [SenderTrust.Vip, SenderTrust.Wellknown],
			dkimMismatch: false,
		});

		assert.equal(windowCalls.length, 1);
		assert.deepEqual(windowCalls[0].search.category, [
			MessageCategory.personal,
		]);
		assert.deepEqual(windowCalls[0].search.senderTrust, [
			SenderTrust.Vip,
			SenderTrust.Wellknown,
		]);
		assert.equal(windowCalls[0].search.dkimMismatch, false);
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

	// #509: `limit` is a page size. A response that carries a page of rows and a
	// count has to state how many messages match, not how many it handed back.
	it("counts the whole match when rows are asked for as well", async () => {
		const pageSize = 2;
		const matches = 4753;
		const windowCalls: number[] = [];
		const client: ThreadSearchClient = {
			threadMessage: {
				async searchByMailboxWindow(_account, _mailbox, _search, options) {
					windowCalls.push(options?.limit ?? 0);
					return {
						items: ACCOUNT_ROWS.slice(0, pageSize),
						continuationToken: "next",
					};
				},
				async countByMailbox() {
					return matches;
				},
			},
			message: { get: async () => [] },
			address: { getAddress: async () => [] },
			messageLabel: { listByMessageIds: async () => [] },
			label: { listByAccountConfig: async () => [] },
			...ownership,
		};

		const response = await executeThreadSearch(client, ACCOUNT, MAILBOX, {
			count: true,
			limit: pageSize,
		});

		assert.deepEqual(windowCalls, [pageSize]);
		assert.equal(response.items?.length, pageSize);
		assert.equal(response.count, matches);
	});

	it("counts the whole match under senderTrust", async () => {
		const trustById = new Map([
			["tm-1", SenderTrust.Vip],
			["tm-2", SenderTrust.Unknown],
			["tm-3", SenderTrust.Wellknown],
		]);
		const countCalls: RecordedCall["search"][] = [];
		const trusted = (search: RecordedCall["search"]) =>
			ACCOUNT_ROWS.filter((row) => {
				const trust = trustById.get(row.threadMessageId);
				return trust !== undefined && search.senderTrust?.includes(trust);
			});
		const client: ThreadSearchClient = {
			threadMessage: {
				async searchByMailboxWindow(_account, _mailbox, search, options) {
					return {
						items: trusted(search).slice(0, options?.limit),
						continuationToken: "next",
					};
				},
				async countByMailbox(_account, _mailbox, search) {
					countCalls.push(search);
					return trusted(search).length;
				},
			},
			message: { get: async () => [] },
			address: { getAddress: async () => [] },
			messageLabel: { listByMessageIds: async () => [] },
			label: { listByAccountConfig: async () => [] },
			...ownership,
		};

		const response = await executeThreadSearch(client, ACCOUNT, MAILBOX, {
			senderTrust: [SenderTrust.Vip, SenderTrust.Wellknown],
			count: true,
			limit: 1,
		});

		assert.equal(response.items?.length, 1);
		assert.equal(response.count, 2);
		assert.deepEqual(countCalls[0].senderTrust, [
			SenderTrust.Vip,
			SenderTrust.Wellknown,
		]);
	});

	it("answers the same count whether or not rows were asked for", async () => {
		const criteria = {
			category: [MessageCategory.personal, MessageCategory.marketing],
			count: true,
		};
		const withRows = await executeThreadSearch(
			fakeClient(ACCOUNT_ROWS).client,
			ACCOUNT,
			MAILBOX,
			criteria,
		);
		const countOnly = await executeThreadSearch(
			fakeClient(ACCOUNT_ROWS).client,
			ACCOUNT,
			MAILBOX,
			{ ...criteria, results: false },
		);

		assert.equal(withRows.count, 2);
		assert.equal(countOnly.count, withRows.count);
	});

	// The page size bounds the rows; it has no say in how many messages match.
	it("holds the count still while the page size moves", async () => {
		const responses = [];
		for (const limit of [1, 500]) {
			const { client } = fakeClient(ACCOUNT_ROWS);
			responses.push(
				await executeThreadSearch(client, ACCOUNT, MAILBOX, {
					count: true,
					limit,
				}),
			);
		}

		assert.deepEqual(
			responses.map((response) => response.items?.length),
			[1, ACCOUNT_ROWS.length],
			"the page did move",
		);
		assert.deepEqual(
			responses.map((response) => response.count),
			[ACCOUNT_ROWS.length, ACCOUNT_ROWS.length],
		);
	});

	// The cursor never reaches the count query, so the number does not shrink as
	// the user pages: page three claims the same total page one did.
	it("holds the count still while the caller pages", async () => {
		const { client, windowCalls, countCalls } = fakeClient(ACCOUNT_ROWS);

		const response = await executeThreadSearch(client, ACCOUNT, MAILBOX, {
			count: true,
			continuationToken: "page-three",
		});

		assert.equal(windowCalls[0].continuationToken, "page-three");
		assert.equal(countCalls.length, 1);
		assert.equal(response.count, ACCOUNT_ROWS.length);
	});

	it("projects category, so the DynamoDB port reads it with the row", () => {
		assert.ok(buildSearchThreadsOptions({}).attributes.includes("category"));
		assert.ok(buildListThreadsOptions({}).attributes.includes("category"));
	});
});
