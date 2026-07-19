import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AwsQueryProtocol } from "@aws-sdk/core/protocols";
import { getSqsClient } from "./config.js";

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
