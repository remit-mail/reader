import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { AwsQueryProtocol } from "@aws-sdk/core/protocols";
import { getImapWorkerQueueUrl, getSqsClient } from "./config.js";

// The queue URL a self-hosted compose stack hands the account worker
// (deploy/vps/remit.env.template). It is a plain http:// URL that is not
// localhost, which is exactly the case the endpoint heuristic used to miss.
const composeQueueUrl =
	"http://queue:9324/000000000000/remit-account-purge-delete.fifo";
const awsQueueUrl =
	"https://sqs.eu-west-1.amazonaws.com/123456789012/remit-account-purge-delete.fifo";

describe("getSqsClient", () => {
	// Regression: the account-deletion cascade sends through this client. It
	// used to be built once at import with no endpoint and no protocol, so on a
	// self-hosted stack every cascade send went to real SQS instead of the local
	// queue server and account deletion never completed.
	it("selects the query protocol and the queue origin for a compose-stack queue URL", async () => {
		const client = getSqsClient(composeQueueUrl);
		assert.equal(client.config.protocol instanceof AwsQueryProtocol, true);
		const endpoint = await client.config.endpoint?.();
		assert.equal(endpoint?.hostname, "queue");
		assert.equal(endpoint?.port, 9324);
	});

	it("leaves the default protocol and endpoint for a real SQS queue URL", async () => {
		const client = getSqsClient(awsQueueUrl);
		assert.equal(client.config.protocol instanceof AwsQueryProtocol, false);
		assert.equal(client.config.endpoint, undefined);
	});

	it("reuses one client per queue URL and keeps distinct queues apart", () => {
		assert.equal(getSqsClient(composeQueueUrl), getSqsClient(composeQueueUrl));
		assert.notEqual(getSqsClient(composeQueueUrl), getSqsClient(awsQueueUrl));
	});
});

describe("getImapWorkerQueueUrl", () => {
	// The imap-worker stop queue is optional: the self-host compose stacks do not
	// provision it, and reading it through expect-env would throw and abort the
	// deletion fanout before it ever reached the finalize step. It must yield
	// undefined when unset so the fanout can skip the (no-op) stop signal.
	const prev = process.env.SQS_QUEUE_URL_IMAP_WORKER;
	afterEach(() => {
		if (prev === undefined) delete process.env.SQS_QUEUE_URL_IMAP_WORKER;
		else process.env.SQS_QUEUE_URL_IMAP_WORKER = prev;
	});

	it("returns undefined when the var is unset instead of throwing", () => {
		delete process.env.SQS_QUEUE_URL_IMAP_WORKER;
		assert.equal(getImapWorkerQueueUrl(), undefined);
	});

	it("returns the configured value when set", () => {
		process.env.SQS_QUEUE_URL_IMAP_WORKER = "http://queue/imap-worker";
		assert.equal(getImapWorkerQueueUrl(), "http://queue/imap-worker");
	});
});
