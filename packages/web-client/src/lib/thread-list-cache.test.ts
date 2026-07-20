import assert from "node:assert";
import { describe, test } from "node:test";
import {
	threadOperationsListThreadsQueryKey,
	threadOperationsSearchThreadsQueryKey,
	unifiedThreadOperationsListAllThreadsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { threadListCacheKeys } from "./thread-list-cache.js";

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
