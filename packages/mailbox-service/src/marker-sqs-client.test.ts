import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	createMarkerSqsClient,
	deriveLocalSqsEndpoint,
} from "./marker-sqs-client.js";

describe("deriveLocalSqsEndpoint — shared by every marker service's SQS client (PR #1292 zoom-out)", () => {
	it("derives the origin for a localhost queue URL (local dev / ElasticMQ)", () => {
		assert.equal(
			deriveLocalSqsEndpoint("http://localhost:4566/000000000000/test-queue"),
			"http://localhost:4566",
		);
	});

	it("returns undefined for a real AWS queue URL (SDK resolves the endpoint itself)", () => {
		assert.equal(
			deriveLocalSqsEndpoint(
				"https://sqs.eu-west-1.amazonaws.com/123456789012/remit-dev-mailboxes.fifo",
			),
			undefined,
		);
	});
});

describe("createMarkerSqsClient", () => {
	it("returns a real SQSClient instance", () => {
		const client = createMarkerSqsClient(
			"http://localhost:4566/000000000000/test-queue",
		);
		assert.ok(client);
		assert.equal(typeof client.send, "function");
	});

	it("prefers an explicit endpoint override over the derived local one", () => {
		const client = createMarkerSqsClient(
			"http://localhost:4566/000000000000/test-queue",
			"http://custom-endpoint:1234",
		);
		assert.ok(client);
	});
});
