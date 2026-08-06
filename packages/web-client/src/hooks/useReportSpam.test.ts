import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	GENERIC_SPAM_ACTION_FAILURE,
	throwOnBulkFailure,
} from "./useReportSpam.js";

describe("throwOnBulkFailure (#648)", () => {
	test("does not throw when the whole batch succeeded", () => {
		assert.doesNotThrow(() =>
			throwOnBulkFailure({ successCount: 1, failureCount: 0 }),
		);
	});

	test("throws the server's own reason for a designed failure", () => {
		// Both bulk endpoints answer 200 even when every message failed —
		// settleSpamReportBulk never rejects the HTTP call — so a caller that
		// only checks for a thrown/rejected request would read this as success.
		assert.throws(
			() =>
				throwOnBulkFailure({
					successCount: 0,
					failureCount: 1,
					failures: [
						{
							messageId: "m1",
							reason:
								"Message m1's move to Junk has not settled yet; try again in a moment.",
						},
					],
				}),
			/has not settled yet/,
		);
	});

	test("falls back to a generic message when a failure carries no reason", () => {
		assert.throws(
			() =>
				throwOnBulkFailure({
					successCount: 0,
					failureCount: 1,
					failures: [],
				}),
			new RegExp(GENERIC_SPAM_ACTION_FAILURE.replace(/[.]/g, "\\.")),
		);
	});

	test("throws on a partial batch, not just a total failure", () => {
		// This hook is always called with exactly one message today, but the
		// check itself must not treat "some succeeded" as "nothing to report".
		assert.throws(
			() =>
				throwOnBulkFailure({
					successCount: 2,
					failureCount: 1,
					failures: [{ messageId: "m3", reason: "boom" }],
				}),
			/boom/,
		);
	});
});
