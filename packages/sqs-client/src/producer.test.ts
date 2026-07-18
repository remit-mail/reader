import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createQueueProducer } from "./producer.js";

describe("createQueueProducer", () => {
	it("returns a real SQSClient for a local queue URL", () => {
		const client = createQueueProducer({
			queueUrl: "http://localhost:4566/000000000000/test-queue",
		});
		assert.equal(typeof client.send, "function");
	});

	it("returns a real SQSClient for a real AWS queue URL", () => {
		const client = createQueueProducer({
			queueUrl:
				"https://sqs.eu-west-1.amazonaws.com/123456789012/remit-dev-mailboxes.fifo",
		});
		assert.equal(typeof client.send, "function");
	});

	it("accepts an explicit endpoint override", () => {
		const client = createQueueProducer({
			queueUrl: "http://localhost:4566/000000000000/test-queue",
			endpoint: "http://custom-endpoint:1234",
		});
		assert.equal(typeof client.send, "function");
	});
});
