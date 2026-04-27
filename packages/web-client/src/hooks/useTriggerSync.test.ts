import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mailboxOperationsListMailboxesQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { buildMailboxListKey } from "./useTriggerSync.js";

describe("buildMailboxListKey", () => {
	test("matches the generated SDK query key for the same accountId", () => {
		// On success the trigger-sync mutation invalidates this key — if it
		// drifts from the generated SDK key, the freshly-synced mailbox rows
		// will not be re-fetched. Pin the contract.
		const accountId = "acc-1234";
		const got = buildMailboxListKey(accountId);
		const want = mailboxOperationsListMailboxesQueryKey({
			path: { accountId },
		});
		assert.deepEqual(got, want);
	});

	test("returns a different key for a different accountId", () => {
		const a = buildMailboxListKey("acc-1");
		const b = buildMailboxListKey("acc-2");
		assert.notDeepEqual(a, b);
	});
});
