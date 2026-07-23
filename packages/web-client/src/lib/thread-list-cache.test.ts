import assert from "node:assert";
import { describe, test } from "node:test";
import {
	threadOperationsListThreadsQueryKey,
	threadOperationsSearchThreadsQueryKey,
	unifiedThreadOperationsListAllThreadsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { QueryClient } from "@tanstack/react-query";
import {
	invalidateThreadListQueries,
	patchThreadListQueries,
	restoreThreadListQueries,
	snapshotThreadListQueries,
	threadListCacheKeys,
} from "./thread-list-cache.js";

describe("threadListCacheKeys", () => {
	test("resolves each mailbox's list and search caches plus the unified one", () => {
		const keys = threadListCacheKeys(["mb1"]);
		assert.deepStrictEqual(keys, [
			threadOperationsListThreadsQueryKey({ path: { mailboxId: "mb1" } }),
			threadOperationsSearchThreadsQueryKey({ path: { mailboxId: "mb1" } }),
			unifiedThreadOperationsListAllThreadsQueryKey(),
		]);
	});

	test("always includes the unified cross-account listing the daily brief reads", () => {
		// #140: the brief kept its unread dot because the read mutation never
		// reached this key. Every caller of the shared source now does.
		const keys = threadListCacheKeys(["mb1", "mb2"]);
		assert.ok(
			keys.some(
				(key) =>
					JSON.stringify(key) ===
					JSON.stringify(unifiedThreadOperationsListAllThreadsQueryKey()),
			),
		);
	});

	test("emits one list and one search key per distinct mailbox", () => {
		const keys = threadListCacheKeys(["mb1", "mb2"]);
		// two mailboxes -> two list + two search + one unified
		assert.strictEqual(keys.length, 5);
	});

	test("dedupes repeated mailbox ids", () => {
		const keys = threadListCacheKeys(["mb1", "mb1"]);
		// one mailbox -> one list + one search + one unified
		assert.strictEqual(keys.length, 3);
	});
});

const thread = (
	overrides: Partial<RemitImapThreadMessageResponse> & { messageId: string },
): RemitImapThreadMessageResponse =>
	({
		threadId: "t1",
		threadMessageId: `tm-${overrides.messageId}`,
		mailboxId: "mb1",
		subject: "s",
		fromName: "n",
		fromEmail: "e",
		sentDate: "2025-01-01T00:00:00Z",
		snippet: "",
		hasAttachment: false,
		hasStars: false,
		isRead: false,
		...overrides,
	}) as RemitImapThreadMessageResponse;

/** The single-shot page the daily brief and Flagged cache under the unified key. */
const briefKey = unifiedThreadOperationsListAllThreadsQueryKey();

/** The brief's search variant caches under the same key plus query options. */
const briefSearchKey = unifiedThreadOperationsListAllThreadsQueryKey({
	query: { query: "invoice", limit: 50 },
});

/** The infinite shape a mailbox list caches. */
const mailboxKey = threadOperationsListThreadsQueryKey({
	path: { mailboxId: "mb1" },
	query: { order: "desc" },
});

const seed = () => {
	const queryClient = new QueryClient();
	queryClient.setQueryData(briefKey, { items: [thread({ messageId: "m1" })] });
	queryClient.setQueryData(briefSearchKey, {
		items: [thread({ messageId: "m1" })],
	});
	queryClient.setQueryData(mailboxKey, {
		pages: [{ items: [thread({ messageId: "m1" })] }],
		pageParams: [undefined],
	});
	return queryClient;
};

const briefItems = (queryClient: QueryClient, key: readonly unknown[]) =>
	queryClient.getQueryData<{ items: RemitImapThreadMessageResponse[] }>(key)
		?.items ?? [];

describe("mutating from the daily brief", () => {
	test("patches the unified listing the brief reads, not only the mailbox list", () => {
		const queryClient = seed();
		patchThreadListQueries(queryClient, threadListCacheKeys(["mb1"]), (items) =>
			items.map((item) => ({ ...item, isRead: true })),
		);
		assert.strictEqual(briefItems(queryClient, briefKey)[0].isRead, true);
		assert.strictEqual(briefItems(queryClient, briefSearchKey)[0].isRead, true);
		const pages = queryClient.getQueryData<{
			pages: Array<{ items: RemitImapThreadMessageResponse[] }>;
		}>(mailboxKey);
		assert.strictEqual(pages?.pages[0].items[0].isRead, true);
	});

	test("removes a deleted row from the brief's page", () => {
		const queryClient = seed();
		patchThreadListQueries(queryClient, threadListCacheKeys(["mb1"]), (items) =>
			items.filter((item) => item.messageId !== "m1"),
		);
		assert.deepStrictEqual(briefItems(queryClient, briefKey), []);
	});

	test("restores the brief's page when the mutation fails", () => {
		const queryClient = seed();
		const prefixes = threadListCacheKeys(["mb1"]);
		const snapshot = snapshotThreadListQueries(queryClient, prefixes);
		patchThreadListQueries(queryClient, prefixes, () => []);
		restoreThreadListQueries(queryClient, snapshot);
		assert.strictEqual(briefItems(queryClient, briefKey).length, 1);
		assert.strictEqual(briefItems(queryClient, briefSearchKey).length, 1);
	});

	test("invalidates the brief's listing so the next read refetches", () => {
		const queryClient = seed();
		invalidateThreadListQueries(queryClient, threadListCacheKeys(["mb1"]));
		assert.strictEqual(
			queryClient.getQueryState(briefKey)?.isInvalidated,
			true,
		);
		assert.strictEqual(
			queryClient.getQueryState(mailboxKey)?.isInvalidated,
			true,
		);
	});
});
