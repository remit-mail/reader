import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isAlwaysFatal } from "@/lib/error-classifier";
import {
	GENERIC_SPAM_ACTION_FAILURE,
	humanizeSpamFailureReason,
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

	test("the thrown error is recoverable, not a client-bug fatal (regression)", () => {
		// A bare `Error` here carries no HTTP status, so the classifier reads it
		// as a client bug and routes it to the full-screen fatal overlay instead
		// of a dismissible banner — for a designed, expected, retryable outcome
		// the backend wrote friendly copy for. This is exactly the regression a
		// prior version of this hook shipped: `pushError` never built a banner,
		// the message/badge/Undo button vanished behind the crash page, and the
		// failure was logged as fatal telemetry.
		assert.throws(
			() =>
				throwOnBulkFailure({
					successCount: 0,
					failureCount: 1,
					failures: [{ messageId: "m1", reason: "has not settled yet" }],
				}),
			(error: unknown) => {
				assert.equal(
					isAlwaysFatal(error),
					false,
					"a per-message report/undo failure must not escalate to the fatal overlay",
				);
				return true;
			},
		);
	});
});

describe("humanizeSpamFailureReason (#648)", () => {
	test("replaces the raw messageId possessive with plain language", () => {
		assert.equal(
			humanizeSpamFailureReason(
				"Message 7f3a2c19-1b4d-4e2a-9c3f-8a1b2c3d4e5f's move to Junk has not settled yet; try again in a moment.",
			),
			"This message's move to Junk has not settled yet; try again in a moment.",
		);
	});

	test("leaves a reason with no embedded messageId unchanged", () => {
		assert.equal(
			humanizeSpamFailureReason(GENERIC_SPAM_ACTION_FAILURE),
			GENERIC_SPAM_ACTION_FAILURE,
		);
	});
});
