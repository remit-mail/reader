import assert from "node:assert";
import { describe, it } from "node:test";
import { getDeduplicationId } from "./emit.js";
import type { SyncMessagesEvent } from "./events.js";

type SyncMessagesInput = Omit<SyncMessagesEvent, "eventId" | "timestamp">;

const syncMessages = (over: Partial<SyncMessagesInput>): SyncMessagesInput => ({
	type: "SYNC_MESSAGES",
	accountId: "acc-1",
	mailboxId: "mbx-1",
	...over,
});

describe("getDeduplicationId for SYNC_MESSAGES continuation", () => {
	it("gives an initial (cursor-less) sync a stable id so concurrent fresh syncs dedup", () => {
		assert.strictEqual(
			getDeduplicationId(syncMessages({})),
			"SYNC_MESSAGES:mbx-1",
		);
	});

	it("gives each continuation batch a distinct id so FIFO does not drop batches 2..N", () => {
		// Regression guard: a constant dedup id per mailbox let SQS FIFO reject
		// every continuation within the 5-minute window, capping a sync at one
		// batch (~200 messages). Folding the batch's remaining count into the id
		// keeps sequential batches distinct.
		const batch2 = getDeduplicationId(syncMessages({ resumeCursor: 800 }));
		const batch3 = getDeduplicationId(syncMessages({ resumeCursor: 600 }));

		assert.strictEqual(batch2, "SYNC_MESSAGES:mbx-1:800");
		assert.strictEqual(batch3, "SYNC_MESSAGES:mbx-1:600");
		assert.notStrictEqual(batch2, batch3);
	});

	it("separates a continuation from the initial event of the same mailbox", () => {
		const initial = getDeduplicationId(syncMessages({}));
		const continuation = getDeduplicationId(
			syncMessages({ resumeCursor: 800 }),
		);

		assert.notStrictEqual(initial, continuation);
	});
});
