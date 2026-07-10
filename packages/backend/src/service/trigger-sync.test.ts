import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import {
	buildScheduledSyncDedupId,
	buildSyncMailboxesCommand,
	triggerAccountSync,
} from "./trigger-sync.js";

const FIFO_QUEUE_URL =
	"https://sqs.eu-west-1.amazonaws.com/123456789012/remit-dev-mailboxes.fifo";
const STANDARD_QUEUE_URL =
	"http://localhost:9324/000000000000/remit-dev-mailboxes";

const parseBody = (cmd: SendMessageCommand): Record<string, unknown> => {
	const body = cmd.input.MessageBody ?? "{}";
	return JSON.parse(body) as Record<string, unknown>;
};

describe("buildSyncMailboxesCommand", () => {
	it("sets MessageGroupId to accountId for FIFO queues", () => {
		const cmd = buildSyncMailboxesCommand({
			sqsClient: {} as SQSClient,
			queueUrl: FIFO_QUEUE_URL,
			accountId: "account-abc",
		});

		assert.equal(cmd.input.MessageGroupId, "account-abc");
	});

	it("sets MessageDeduplicationId to SYNC_MAILBOXES:<accountId> for FIFO queues", () => {
		const cmd = buildSyncMailboxesCommand({
			sqsClient: {} as SQSClient,
			queueUrl: FIFO_QUEUE_URL,
			accountId: "account-abc",
		});

		assert.equal(
			cmd.input.MessageDeduplicationId,
			"SYNC_MAILBOXES:account-abc",
		);
	});

	it("does not set FIFO params for standard queues", () => {
		const cmd = buildSyncMailboxesCommand({
			sqsClient: {} as SQSClient,
			queueUrl: STANDARD_QUEUE_URL,
			accountId: "account-abc",
		});

		assert.equal(cmd.input.MessageGroupId, undefined);
		assert.equal(cmd.input.MessageDeduplicationId, undefined);
	});

	it("builds a SYNC_MAILBOXES event body with accountId and eventId", () => {
		const cmd = buildSyncMailboxesCommand({
			sqsClient: {} as SQSClient,
			queueUrl: FIFO_QUEUE_URL,
			accountId: "account-abc",
		});

		const event = parseBody(cmd);
		assert.equal(event.type, "SYNC_MAILBOXES");
		assert.equal(event.accountId, "account-abc");
		assert.equal(typeof event.eventId, "string");
		assert.equal(typeof event.timestamp, "number");
	});

	it("targets the configured queue url", () => {
		const cmd = buildSyncMailboxesCommand({
			sqsClient: {} as SQSClient,
			queueUrl: FIFO_QUEUE_URL,
			accountId: "account-abc",
		});

		assert.equal(cmd.input.QueueUrl, FIFO_QUEUE_URL);
	});

	it("uses the caller-supplied dedupId instead of the manual default", () => {
		const cmd = buildSyncMailboxesCommand({
			sqsClient: {} as SQSClient,
			queueUrl: FIFO_QUEUE_URL,
			accountId: "account-abc",
			dedupId: "SYNC_MAILBOXES:scheduled:account-abc:12345",
		});

		assert.equal(
			cmd.input.MessageDeduplicationId,
			"SYNC_MAILBOXES:scheduled:account-abc:12345",
		);
	});
});

describe("buildScheduledSyncDedupId", () => {
	const FIVE_MINUTES_MS = 5 * 60 * 1000;

	it("differs from the manual-trigger dedup id", () => {
		const scheduled = buildScheduledSyncDedupId(
			"account-abc",
			Date.now(),
			FIVE_MINUTES_MS,
		);

		assert.notEqual(scheduled, "SYNC_MAILBOXES:account-abc");
	});

	it("is stable within the same time bucket (dedupes a retried tick)", () => {
		const bucketStart = 10 * FIVE_MINUTES_MS;

		const first = buildScheduledSyncDedupId(
			"account-abc",
			bucketStart,
			FIVE_MINUTES_MS,
		);
		const second = buildScheduledSyncDedupId(
			"account-abc",
			bucketStart + 1_000,
			FIVE_MINUTES_MS,
		);

		assert.equal(first, second);
	});

	it("changes across a bucket boundary (never dedupes two ticks apart)", () => {
		const bucketStart = 10 * FIVE_MINUTES_MS;

		const thisTick = buildScheduledSyncDedupId(
			"account-abc",
			bucketStart,
			FIVE_MINUTES_MS,
		);
		const nextTick = buildScheduledSyncDedupId(
			"account-abc",
			bucketStart + FIVE_MINUTES_MS,
			FIVE_MINUTES_MS,
		);

		assert.notEqual(thisTick, nextTick);
	});
});

describe("triggerAccountSync", () => {
	it("sends a SendMessageCommand to the client", async () => {
		const sent: SendMessageCommand[] = [];
		const sqsClient = {
			send: async (cmd: SendMessageCommand) => {
				sent.push(cmd);
				return {};
			},
		} as unknown as SQSClient;

		const result = await triggerAccountSync({
			sqsClient,
			queueUrl: FIFO_QUEUE_URL,
			accountId: "account-xyz",
		});

		assert.equal(sent.length, 1);
		const cmd = sent[0];
		if (!cmd) throw new Error("expected command");
		assert.ok(cmd instanceof SendMessageCommand);
		assert.equal(cmd.input.MessageGroupId, "account-xyz");
		assert.equal(typeof result.eventId, "string");
	});

	it("propagates SQS send errors to the caller", async () => {
		const sqsClient = {
			send: async () => {
				throw new Error("MissingRequiredParameterException");
			},
		} as unknown as SQSClient;

		await assert.rejects(
			triggerAccountSync({
				sqsClient,
				queueUrl: FIFO_QUEUE_URL,
				accountId: "account-xyz",
			}),
			/MissingRequiredParameterException/,
		);
	});
});
