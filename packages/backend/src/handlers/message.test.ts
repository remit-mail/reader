import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { settleSpamReportBulk } from "./message.js";

describe("settleSpamReportBulk", () => {
	it("aggregates successes and failures, with a reason per failure", async () => {
		const outcome = await settleSpamReportBulk(
			["msg-1", "msg-2", "msg-3"],
			async (messageId) => {
				if (messageId === "msg-2") {
					throw new Error("has not settled yet; try again in a moment.");
				}
			},
		);

		assert.equal(outcome.successCount, 2);
		assert.equal(outcome.failureCount, 1);
		assert.deepEqual(outcome.failures, [
			{
				messageId: "msg-2",
				reason: "has not settled yet; try again in a moment.",
			},
		]);
	});

	it("omits failures entirely when every message succeeds", async () => {
		const outcome = await settleSpamReportBulk(
			["msg-1", "msg-2"],
			async () => {},
		);

		assert.equal(outcome.successCount, 2);
		assert.equal(outcome.failureCount, 0);
		assert.equal(outcome.failures, undefined);
	});

	it("stringifies a non-Error rejection rather than losing the reason", async () => {
		const outcome = await settleSpamReportBulk(["msg-1"], () =>
			Promise.reject("raw string rejection"),
		);

		assert.deepEqual(outcome.failures, [
			{ messageId: "msg-1", reason: "raw string rejection" },
		]);
	});

	it("runs every message concurrently — total time is one wait, not N waits", async () => {
		const WAIT_MS = 60;
		const start = Date.now();

		await settleSpamReportBulk(
			Array.from({ length: 10 }, (_, i) => `msg-${i}`),
			() => new Promise((resolve) => setTimeout(resolve, WAIT_MS)),
		);

		const elapsed = Date.now() - start;
		assert.ok(
			elapsed < WAIT_MS * 5,
			`expected roughly one wait (~${WAIT_MS}ms), took ${elapsed}ms — looks sequential`,
		);
	});
});
