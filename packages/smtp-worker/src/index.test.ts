/**
 * The delivery count the settle decision is made on comes from the queue, and
 * nothing between the record and the handler is allowed to drop it: a handler
 * that always sees 1 never reaches the settle at all, and the row dead-letters
 * at `sending` exactly as it did before #951.
 *
 * The send handler is replaced here, so this file is about the wiring and not
 * about what the handler does with it — and replacing it is also what keeps
 * the real one's data ports and queue producers out of a unit test.
 */
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { Context, SQSEvent } from "aws-lambda";

const receiveCounts: number[] = [];

mock.module("./handlers/send-message.js", {
	namedExports: {
		handleSendMessage: async (
			_event: unknown,
			_log: unknown,
			receiveCount: number,
		): Promise<void> => {
			receiveCounts.push(receiveCount);
		},
	},
});

const { handler, parseReceiveCount } = await import("./index.js");

const context = {
	functionName: "smtp-worker-test",
	awsRequestId: "req-1",
} as Context;

const sendMessageEvent = (approximateReceiveCount: string): SQSEvent =>
	({
		Records: [
			{
				messageId: "sqs-1",
				receiptHandle: "rh-1",
				body: JSON.stringify({
					type: "SEND_MESSAGE",
					eventId: "evt-1",
					timestamp: 0,
					accountId: "acc-1",
					outboxMessageId: "obx-1",
				}),
				attributes: { ApproximateReceiveCount: approximateReceiveCount },
				messageAttributes: {},
				md5OfBody: "",
				eventSource: "aws:sqs",
				eventSourceARN: "http://queue:9324/000000000000/remit-smtp",
				awsRegion: "local",
			},
		],
	}) as unknown as SQSEvent;

describe("parseReceiveCount — SQS ApproximateReceiveCount parsing", () => {
	it("parses the raw string attribute", () => {
		assert.equal(parseReceiveCount("1"), 1);
		assert.equal(parseReceiveCount("3"), 3);
	});

	it("defaults to 1 when the attribute is missing", () => {
		assert.equal(parseReceiveCount(undefined), 1);
	});

	it("defaults to 1 on a non-numeric or non-positive value", () => {
		assert.equal(parseReceiveCount("not-a-number"), 1);
		assert.equal(parseReceiveCount("0"), 1);
		assert.equal(parseReceiveCount("-1"), 1);
	});
});

describe("the record's delivery count reaches the send handler", () => {
	it("threads ApproximateReceiveCount through the processor into handleSendMessage", async () => {
		receiveCounts.length = 0;

		const response = await handler(sendMessageEvent("3"), context);

		assert.deepEqual(receiveCounts, [3]);
		assert.deepEqual(response.batchItemFailures, []);
	});

	it("carries the first delivery through as 1", async () => {
		receiveCounts.length = 0;

		await handler(sendMessageEvent("1"), context);

		assert.deepEqual(receiveCounts, [1]);
	});
});
