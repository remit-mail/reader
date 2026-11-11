import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MessagePlacementUnsettledError } from "@remit/data-ports/errors";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import { recordingQueue } from "@remit/data-ports/recording-queue";
import { NoJunkMailboxError } from "@remit/mailbox-service";
import type { Context } from "openapi-backend";
import { testApiConfig } from "../config/test-config.js";
import type { RemitClient } from "../service/data-client.js";
import {
	GENERIC_FAILURE_REASON,
	MessageBulkOperations,
	settleSpamReportBulk,
} from "./message.js";

describe("settleSpamReportBulk", () => {
	it("aggregates successes and failures, surfacing the one allowlisted reason verbatim", async () => {
		const outcome = await settleSpamReportBulk(
			["msg-1", "msg-2", "msg-3"],
			async (messageId) => {
				if (messageId === "msg-2") {
					throw new NoJunkMailboxError();
				}
			},
		);

		assert.equal(outcome.successCount, 2);
		assert.equal(outcome.failureCount, 1);
		assert.deepEqual(outcome.failures, [
			{
				messageId: "msg-2",
				reason: new NoJunkMailboxError().message,
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

	// A refusal the move gate raises used to collapse to the generic retry copy,
	// which is a dead end (#665). One reason reaches it now — a mutation still in
	// flight — and it words the wait rather than the server's sentence.
	it("words a placement refusal from its reason, never from the server's sentence", async () => {
		const outcome = await settleSpamReportBulk(
			["msg-1", "msg-2"],
			async (messageId) => {
				throw new MessagePlacementUnsettledError(
					`Message ${messageId} was not acted on: its folder and uid do not name the same message`,
					"acc-1",
					messageId,
					"in_flight",
				);
			},
		);

		const reasons = outcome.failures?.map((f) => f.reason) ?? [];
		assert.equal(reasons.length, 2);
		for (const reason of reasons) {
			assert.match(reason ?? "", /try again in a moment/i);
			assert.notEqual(reason, GENERIC_FAILURE_REASON);
			assert.doesNotMatch(reason ?? "", /folder and uid/);
			assert.doesNotMatch(reason ?? "", /acc-1/);
		}
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

describe("MessageBulkOperations_notSpam never-spam back-apply (#1553)", () => {
	it("enqueues one back-apply for a sender whose two messages were marked not spam", async () => {
		const sub = "cognito-sub-1553";
		const accountConfigId = deriveAccountConfigId(sub);
		const accountFanout = recordingQueue();
		const grant = {
			accountConfigId,
			addressId: "addr-friend",
			normalizedEmail: "friend@example.org",
		};
		const client = {
			queues: { accountFanout },
			message: {
				get: async (messageId: string) => ({ messageId, mailboxId: "junk-1" }),
			},
			account: {
				listAllByAccountConfig: async () => [{ accountId: "acc-1" }],
			},
			mailbox: {
				get: async () => [{ mailboxId: "junk-1", accountId: "acc-1" }],
			},
			spamReport: { notSpam: async () => grant },
		} as unknown as RemitClient;

		await MessageBulkOperations.MessageBulkOperations_notSpam(
			{
				request: { requestBody: { messageIds: ["msg-1", "msg-2"] } },
			} as unknown as Context,
			{
				client,
				config: testApiConfig(),
				identity: {
					kind: "user",
					accountConfigId,
					sub,
					email: `${sub}@example.com`,
				},
			},
		);

		assert.deepEqual(
			accountFanout.sent.map((message) => message.body),
			[{ type: "SenderNeverSpamBackApply", ...grant }],
		);
	});
});
