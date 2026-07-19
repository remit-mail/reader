import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SQSClient } from "@aws-sdk/client-sqs";
import { AwsQueryProtocol } from "@aws-sdk/core/protocols";
import { createQueueProducer, isLocalEndpoint } from "./producer.js";

// The queue URL a self-hosted compose stack hands its workers: a plain
// http:// URL addressing the queue container by name, never "localhost".
const composeQueueUrl = "http://queue:9324/000000000000/mailboxes";
const awsQueueUrl =
	"https://sqs.eu-west-1.amazonaws.com/123456789012/remit-dev-mailboxes.fifo";

const usesQueryProtocol = (client: SQSClient): boolean =>
	client.config.protocol instanceof AwsQueryProtocol;

const resolvedEndpoint = async (
	client: SQSClient,
): Promise<string | undefined> => {
	const { endpoint } = client.config;
	if (!endpoint) return undefined;
	const resolved = await endpoint();
	return `${resolved.protocol}//${resolved.hostname}:${resolved.port}`;
};

describe("isLocalEndpoint", () => {
	it("treats a non-localhost http:// queue URL as local", () => {
		assert.equal(isLocalEndpoint(composeQueueUrl), true);
	});

	it("treats http://localhost as local", () => {
		assert.equal(
			isLocalEndpoint("http://localhost:9324/000000000000/mailboxes"),
			true,
		);
	});

	it("treats https://localhost as local", () => {
		assert.equal(
			isLocalEndpoint("https://localhost:9324/000000000000/mailboxes"),
			true,
		);
	});

	it("treats a real SQS queue URL as remote", () => {
		assert.equal(isLocalEndpoint(awsQueueUrl), false);
	});
});

describe("createQueueProducer", () => {
	// Regression (self-host stack): a queue URL of http://queue:9324/... used to
	// fall through to the AWS JSON protocol, so every send hit the local queue
	// server with a body it cannot parse and mail never synced.
	it("selects the query protocol for a non-localhost http:// queue URL", async () => {
		const client = createQueueProducer({ queueUrl: composeQueueUrl });
		assert.equal(usesQueryProtocol(client), true);
		assert.equal(await resolvedEndpoint(client), "http://queue:9324");
	});

	it("selects the query protocol for a localhost queue URL", () => {
		const client = createQueueProducer({
			queueUrl: "http://localhost:9324/000000000000/mailboxes",
		});
		assert.equal(usesQueryProtocol(client), true);
	});

	it("leaves the default protocol and endpoint for a real AWS queue URL", async () => {
		const client = createQueueProducer({ queueUrl: awsQueueUrl });
		assert.equal(usesQueryProtocol(client), false);
		assert.equal(await resolvedEndpoint(client), undefined);
	});

	it("accepts an explicit endpoint override", async () => {
		const client = createQueueProducer({
			queueUrl: composeQueueUrl,
			endpoint: "http://custom-endpoint:1234",
		});
		assert.equal(usesQueryProtocol(client), true);
		assert.equal(await resolvedEndpoint(client), "http://custom-endpoint:1234");
	});

	it("uses localCredentials only for a local endpoint", async () => {
		const local = createQueueProducer({
			queueUrl: composeQueueUrl,
			localCredentials: { accessKeyId: "local", secretAccessKey: "local" },
			env: {},
		});
		assert.equal((await local.config.credentials()).accessKeyId, "local");

		const remote = createQueueProducer({
			queueUrl: awsQueueUrl,
			localCredentials: { accessKeyId: "local", secretAccessKey: "local" },
			env: { SQS_ACCESS_KEY_ID: "real", SQS_SECRET_ACCESS_KEY: "real" },
		});
		assert.equal((await remote.config.credentials()).accessKeyId, "real");
	});
});
