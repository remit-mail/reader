import assert from "node:assert/strict";
import { describe, test } from "node:test";
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

	test("strips the real messageId shape out of the designed reason", () => {
		// Message ids are 25-char base36 (`translator.generate()` in
		// packages/data-ports/src/id.ts), never a dashed UUID — a fixture
		// shaped like one proves nothing about what the user actually sees.
		const realId = "9m2k7x4vqz1jd0tn3wf8b6y5c";
		assert.throws(
			() =>
				throwOnBulkFailure({
					successCount: 0,
					failureCount: 1,
					failures: [
						{
							messageId: realId,
							reason: `Message ${realId}'s move to Junk has not settled yet; try again in a moment.`,
						},
					],
				}),
			(error: unknown) => {
				assert.ok(error instanceof Error);
				assert.equal(
					error.message,
					"This message's move to Junk has not settled yet; try again in a moment.",
				);
				assert.ok(!error.message.includes(realId), "the raw id must not leak");
				return true;
			},
		);
	});
});

describe("humanizeSpamFailureReason (#648)", () => {
	test("replaces the real-shaped messageId possessive with plain language", () => {
		// Base36, not a dashed UUID — see the note above.
		const realId = "9m2k7x4vqz1jd0tn3wf8b6y5c";
		assert.equal(
			humanizeSpamFailureReason(
				`Message ${realId}'s move to Junk has not settled yet; try again in a moment.`,
				realId,
			),
			"This message's move to Junk has not settled yet; try again in a moment.",
		);
	});

	test("leaves a reason with no embedded messageId unchanged", () => {
		assert.equal(
			humanizeSpamFailureReason(
				GENERIC_SPAM_ACTION_FAILURE,
				"9m2k7x4vqz1jd0tn3wf8b6y5c",
			),
			GENERIC_SPAM_ACTION_FAILURE,
		);
	});
});
