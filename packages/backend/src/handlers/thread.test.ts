import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	ResultList,
	ThreadMessageItem,
} from "@remit/remit-electrodb-service";
import { MessageCategory, SenderTrust, StarColor } from "@remit/domain-enums";
import {
	buildListThreadMessagesOptions,
	buildListThreadsOptions,
	buildSearchThreadsOptions,
	executeThreadSearch,
	type ThreadSearchClient,
} from "./thread.js";

// Regression coverage for #212. These helpers wrap the option construction
// for the three thread-listing handlers so the `excludeDeleted: true`
// default — the central piece of the #212 backend fix — is testable
// without booting DynamoDB. The defaults must stay:
//
//   * `order: "desc"` when the caller does not specify one
//   * `excludeDeleted: true` regardless of caller input
//
// The service-level option remains opt-in (`excludeDeleted` defaults to
// `false` on `ThreadMessageService.listByMailbox`) so a future Trash /
// All-Mail UI can read soft-deleted rows when it explicitly asks for them.
// The handlers — which serve the inbox listing — must always exclude.

describe("buildListThreadsOptions (#212)", () => {
	it("forces excludeDeleted: true regardless of input", () => {
		const opts = buildListThreadsOptions({});
		assert.equal(opts.excludeDeleted, true);
	});

	it("defaults order to 'desc'", () => {
		const opts = buildListThreadsOptions({});
		assert.equal(opts.order, "desc");
	});

	it("respects an explicit order parameter", () => {
		const opts = buildListThreadsOptions({ order: "asc" });
		assert.equal(opts.order, "asc");
		assert.equal(opts.excludeDeleted, true);
	});

	it("forwards continuationToken", () => {
		const opts = buildListThreadsOptions({ continuationToken: "alice-token" });
		assert.equal(opts.continuationToken, "alice-token");
	});

	it("includes ThreadMessage attributes for projected reads", () => {
		const opts = buildListThreadsOptions({});
		assert.ok(Array.isArray(opts.attributes));
		assert.ok(
			opts.attributes.includes("isDeleted"),
			"isDeleted must be projected so the optional client-side filter works",
		);
	});
});

describe("buildSearchThreadsOptions (#212)", () => {
	it("forces excludeDeleted: true so search hits never surface deleted rows", () => {
		assert.equal(buildSearchThreadsOptions({}).excludeDeleted, true);
		assert.equal(
			buildSearchThreadsOptions({ order: "asc" }).excludeDeleted,
			true,
		);
	});

	it("defaults order to 'desc'", () => {
		assert.equal(buildSearchThreadsOptions({}).order, "desc");
	});
});

describe("buildListThreadMessagesOptions (#212)", () => {
	it("forces excludeDeleted: true so deleted messages never appear inside a thread view", () => {
		assert.equal(buildListThreadMessagesOptions({}).excludeDeleted, true);
	});

	it("defaults order to 'desc'", () => {
		assert.equal(buildListThreadMessagesOptions({}).order, "desc");
	});

	it("forwards mailboxId for thread-by-mailbox dedup", () => {
		const opts = buildListThreadMessagesOptions({ mailboxId: "alice-mb-aaa" });
		assert.equal(opts.mailboxId, "alice-mb-aaa");
	});
});

const buildRow = (
	overrides: Partial<ThreadMessageItem> = {},
): ThreadMessageItem => ({
	threadMessageId: "tm-1",
	threadId: "t-1",
	messageId: "m-1",
	accountConfigId: "acc-1",
	mailboxId: "mb-1",
	uid: 1,
	referenceOrder: 0,
	internalDate: 0,
	sentDate: 0,
	isRead: false,
	isDeleted: false,
	hasAttachment: false,
	hasStars: false,
	messageIdHeader: "msg-1@example.com",
	subject: "subject",
	fromEmail: "a@example.com",
	fromName: "A",
	star: StarColor.None,
	snippet: "",
	category: MessageCategory.uncategorized,
	createdAt: 0,
	updatedAt: 0,
	...overrides,
});

interface CallCounts {
	window: number;
	count: number;
}

const buildFakeClient = (
	rows: ThreadMessageItem[],
	countValue: number,
	calls: CallCounts,
	continuationToken?: string,
): ThreadSearchClient => ({
	threadMessage: {
		searchByMailboxWindow: async (): Promise<ResultList<ThreadMessageItem>> => {
			calls.window += 1;
			return { items: rows, continuationToken };
		},
		countByMailbox: async (): Promise<number> => {
			calls.count += 1;
			return countValue;
		},
	},
	// Trivial enrichment: no Message/Address rows, so every row resolves to
	// senderTrust "unknown" with no category/authenticity.
	message: { get: async () => [] },
	address: { getAddress: async () => [] },
});

describe("executeThreadSearch (on-row / keyed path)", () => {
	it("returns enriched items and forwards the continuationToken by default", async () => {
		const calls = { window: 0, count: 0 };
		const client = buildFakeClient(
			[buildRow({ threadMessageId: "a" }), buildRow({ threadMessageId: "b" })],
			0,
			calls,
			"next-token",
		);

		const result = await executeThreadSearch(client, "acc-1", "mb-1", {});

		assert.equal(result.items?.length, 2);
		assert.equal(result.continuationToken, "next-token");
		assert.equal(result.count, undefined);
		assert.equal(calls.window, 1);
		assert.equal(calls.count, 0);
	});

	it("count-only (results=false) skips the window read and returns just the count", async () => {
		const calls = { window: 0, count: 0 };
		const client = buildFakeClient([buildRow({})], 42, calls);

		const result = await executeThreadSearch(client, "acc-1", "mb-1", {
			results: false,
			count: true,
		});

		assert.equal(result.items, undefined);
		assert.equal(result.count, 42);
		assert.equal(calls.window, 0);
		assert.equal(calls.count, 1);
	});

	it("derives count from the window (count == items.length) when both results and count are requested", async () => {
		// countByMailbox returns 9, but it must NOT be called: results already
		// yielded the exact match set over the window, so count == items.length.
		const calls = { window: 0, count: 0 };
		const client = buildFakeClient(
			[buildRow({ threadMessageId: "a" }), buildRow({ threadMessageId: "b" })],
			9,
			calls,
		);

		const result = await executeThreadSearch(client, "acc-1", "mb-1", {
			count: true,
		});

		assert.equal(result.items?.length, 2);
		assert.equal(
			result.count,
			2,
			"count is the window match count, not a second read",
		);
		assert.equal(calls.window, 1);
		assert.equal(
			calls.count,
			0,
			"no separate Select:COUNT when results are returned",
		);
	});
});

describe("executeThreadSearch (off-row criteria)", () => {
	it("enriches the window and filters by senderTrust, never calling countByMailbox", async () => {
		const calls = { window: 0, count: 0 };
		const client = buildFakeClient(
			[buildRow({ threadMessageId: "a" }), buildRow({ threadMessageId: "b" })],
			999,
			calls,
		);

		const matchUnknown = await executeThreadSearch(client, "acc-1", "mb-1", {
			senderTrust: [SenderTrust.Unknown],
			count: true,
		});
		assert.equal(matchUnknown.items?.length, 2);
		assert.equal(matchUnknown.count, 2);
		assert.equal(calls.window, 1);
		assert.equal(calls.count, 0, "off-row count must not use Select:COUNT");

		const matchVip = await executeThreadSearch(client, "acc-1", "mb-1", {
			senderTrust: [SenderTrust.Vip],
			count: true,
		});
		assert.equal(matchVip.items?.length, 0);
		assert.equal(matchVip.count, 0);
	});

	it("off-row count-only omits items but still reads+enriches the window", async () => {
		const calls = { window: 0, count: 0 };
		const client = buildFakeClient([buildRow({}), buildRow({})], 0, calls);

		const result = await executeThreadSearch(client, "acc-1", "mb-1", {
			senderTrust: [SenderTrust.Unknown],
			results: false,
			count: true,
		});

		assert.equal(result.items, undefined);
		assert.equal(result.count, 2);
		assert.equal(calls.window, 1);
		assert.equal(calls.count, 0);
	});
});
