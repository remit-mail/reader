import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	MoveNotSettledError,
	NoJunkMailboxError,
} from "@remit/mailbox-service";
import { GENERIC_FAILURE_REASON, settleSpamReportBulk } from "./message.js";

describe("settleSpamReportBulk", () => {
	it("aggregates successes and failures, surfacing the one allowlisted reason verbatim", async () => {
		const outcome = await settleSpamReportBulk(
			["msg-1", "msg-2", "msg-3"],
			async (messageId) => {
				if (messageId === "msg-2") {
					throw new MoveNotSettledError(messageId);
				}
			},
		);

		assert.equal(outcome.successCount, 2);
		assert.equal(outcome.failureCount, 1);
		assert.deepEqual(outcome.failures, [
			{
				messageId: "msg-2",
				reason:
					"Message msg-2's move to Junk has not settled yet; try again in a moment.",
			},
		]);
	});

	it("tells the user to create the missing Junk folder rather than to try again", async () => {
		// Retrying cannot resolve this one, so the generic retry copy would be a
		// dead end. The service's own text names the folder and the fix.
		const outcome = await settleSpamReportBulk(["msg-1"], async () => {
			throw new NoJunkMailboxError();
		});

		const reason = outcome.failures?.[0].reason ?? "";
		assert.match(reason, /no Junk folder/);
		assert.match(reason, /Create one/);
		assert.notEqual(reason, GENERIC_FAILURE_REASON);
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

	// The response is user-facing (the field is documented as shown as-is) and
	// this is a 200, not an error path guarded by error.ts's own flattening —
	// so this is the one place a raw internal message could otherwise leak: an
	// account id in "No Junk mailbox found for account <id>", a message id in
	// "has no From address to act on", or an AWS SDK message naming a queue
	// URL or ECONNREFUSED host:port on an SQS failure.
	it("never puts an arbitrary error's raw text in the response — only the allowlisted reason ships", async () => {
		const outcome = await settleSpamReportBulk(
			["msg-leaky-error", "msg-leaky-string", "msg-settled-ok"],
			async (messageId) => {
				if (messageId === "msg-leaky-error") {
					throw new Error(
						"No Junk mailbox found for account acc-super-secret-internal-id",
					);
				}
				if (messageId === "msg-leaky-string") {
					return Promise.reject("ECONNREFUSED sqs.us-east-1.amazonaws.com:443");
				}
			},
		);

		assert.equal(outcome.failureCount, 2);
		const reasons = outcome.failures?.map((f) => f.reason) ?? [];
		assert.deepEqual(reasons, [GENERIC_FAILURE_REASON, GENERIC_FAILURE_REASON]);

		const leaked = reasons.some(
			(reason) =>
				reason.includes("acc-super-secret-internal-id") ||
				reason.includes("ECONNREFUSED") ||
				reason.includes("amazonaws.com"),
		);
		assert.equal(leaked, false, "no internal detail may reach the response");
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
