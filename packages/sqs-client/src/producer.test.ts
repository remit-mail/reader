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

	// A prefix match on "https://localhost" reads all of these as local. The
	// host is localhost in none of them.
	it("treats an https host that merely starts with localhost as remote", () => {
		assert.equal(isLocalEndpoint("https://localhost.example.com/0/q"), false);
		assert.equal(
			isLocalEndpoint("https://localhost-queue.example.com/0/q"),
			false,
		);
	});

	it("treats an https URL with localhost in the userinfo as remote", () => {
		assert.equal(isLocalEndpoint("https://localhost@example.com/0/q"), false);
		assert.equal(
			isLocalEndpoint("https://localhost:pass@example.com/0/q"),
			false,
		);
	});

	// The mirror image: a prefix match misses these, and they are local.
	it("treats a loopback https URL carrying credentials as local", () => {
		assert.equal(isLocalEndpoint("https://user:pass@localhost/0/q"), true);
	});

	it("ignores scheme case", () => {
		assert.equal(isLocalEndpoint("HTTP://queue:9324/0/q"), true);
		assert.equal(isLocalEndpoint("HtTpS://localhost:9324/0/q"), true);
	});

	it("treats loopback addresses over https as local", () => {
		assert.equal(isLocalEndpoint("https://127.0.0.1:9324/0/q"), true);
		assert.equal(isLocalEndpoint("https://[::1]:9324/0/q"), true);
	});

	it("treats any http URL as local regardless of host, port, or credentials", () => {
		assert.equal(isLocalEndpoint("http://queue/0/q"), true);
		assert.equal(isLocalEndpoint("http://user:pass@queue:9324/0/q"), true);
		assert.equal(isLocalEndpoint("http://example.com/0/q"), true);
	});

	// Must not throw: several callers construct their client at module load, so
	// a throw here would take the worker down at import.
	it("treats an unparseable queue URL as remote without throwing", () => {
		assert.equal(isLocalEndpoint(""), false);
		assert.equal(isLocalEndpoint("not a url"), false);
		assert.equal(isLocalEndpoint("queue:9324/0/q"), false);
		assert.equal(isLocalEndpoint("//queue:9324/0/q"), false);
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

	it("does not throw when the queue URL is unparseable", async () => {
		const client = createQueueProducer({ queueUrl: "not a url" });
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
