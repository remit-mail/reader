import assert from "node:assert";
import { describe, test } from "node:test";
import { unifiedThreadOperationsListAllThreadsQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { threadListCacheKeys } from "@/lib/thread-list-cache";
import { mailboxesTouchedBy } from "./useEscalatedActions.js";

describe("mailboxesTouchedBy", () => {
	test("a delete or mark-read run touches only the mailbox it ran over", () => {
		assert.deepStrictEqual(mailboxesTouchedBy({ kind: "delete" }, "mb1"), [
			"mb1",
		]);
		assert.deepStrictEqual(mailboxesTouchedBy({ kind: "markRead" }, "mb1"), [
			"mb1",
		]);
	});

	test("a move run also touches the destination", () => {
		assert.deepStrictEqual(
			mailboxesTouchedBy({ kind: "move", destinationMailboxId: "mb2" }, "mb1"),
			["mb1", "mb2"],
		);
	});

	test("its cache keys reach the unified listing the daily brief reads", () => {
		const keys = threadListCacheKeys(
			mailboxesTouchedBy({ kind: "delete" }, "mb1"),
		);
		assert.ok(
			keys.some(
				(key) =>
					JSON.stringify(key) ===
					JSON.stringify(unifiedThreadOperationsListAllThreadsQueryKey()),
			),
		);
	});
});
