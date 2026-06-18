import assert from "node:assert";
import { describe, it } from "node:test";
import type { FlagSyncResult } from "@remit/mailbox-service";
import { assertFlagSyncComplete } from "./sync-flags.js";

const result = (over: Partial<FlagSyncResult>): FlagSyncResult => ({
	successCount: 0,
	failedCount: 0,
	errors: [],
	...over,
});

describe("assertFlagSyncComplete", () => {
	it("does not throw when every flag operation succeeded", () => {
		assert.doesNotThrow(() =>
			assertFlagSyncComplete(result({ successCount: 3 }), "mbx-1"),
		);
	});

	it("throws when any flag operation failed, so SQS retries the message", () => {
		// Returning normally on a partial failure would let SQS delete the
		// message and silently drop the failed flag change — permanent
		// DynamoDB <-> IMAP divergence. The throw keeps it on the queue.
		assert.throws(
			() =>
				assertFlagSyncComplete(
					result({
						successCount: 1,
						failedCount: 2,
						errors: [
							{ messageId: "m1", error: "boom" },
							{ messageId: "m2", error: "boom" },
						],
					}),
					"mbx-1",
				),
			/2 failed operation\(s\) for mailbox mbx-1/,
		);
	});
});
