import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
	DeleteObjectsCommand,
	ListObjectsV2Command,
	S3Client,
} from "@aws-sdk/client-s3";
import {
	type RecordingQueue,
	recordingQueue,
} from "@remit/data-ports/recording-queue";
import { noopLogger } from "@remit/logger";
import { mockClient } from "aws-sdk-client-mock";
import type { DeleteAccountObjectsEvent } from "../events.js";
import { workerQueuesOn } from "../test-helpers/worker-queues.js";
import { handleDeleteAccountObjects } from "./delete-account-objects.js";

const s3Mock = mockClient(S3Client);
let queue: RecordingQueue;

const event: DeleteAccountObjectsEvent = {
	type: "DELETE_ACCOUNT_OBJECTS",
	accountConfigId: "cfg-1",
};

describe("handleDeleteAccountObjects", () => {
	beforeEach(() => {
		queue = recordingQueue();
	});

	afterEach(() => {
		s3Mock.reset();
	});

	it("lists and deletes every object under the account prefix in one page", async () => {
		s3Mock.on(ListObjectsV2Command).resolves({
			Contents: [
				{ Key: "accounts/cfg-1/a.eml" },
				{ Key: "accounts/cfg-1/b.eml" },
			],
			IsTruncated: false,
		});
		s3Mock.on(DeleteObjectsCommand).resolves({});

		await handleDeleteAccountObjects(event, noopLogger, workerQueuesOn(queue));

		const listCall = s3Mock.commandCalls(ListObjectsV2Command)[0];
		assert.equal(listCall.args[0].input.Prefix, "accounts/cfg-1/");

		const deleteCall = s3Mock.commandCalls(DeleteObjectsCommand)[0];
		assert.deepEqual(deleteCall.args[0].input.Delete?.Objects, [
			{ Key: "accounts/cfg-1/a.eml" },
			{ Key: "accounts/cfg-1/b.eml" },
		]);
		assert.equal(queue.sent.length, 0);
	});

	it("follows the continuation token across truncated pages", async () => {
		s3Mock
			.on(ListObjectsV2Command)
			.resolvesOnce({
				Contents: [{ Key: "accounts/cfg-1/p1.eml" }],
				IsTruncated: true,
				NextContinuationToken: "tok-2",
			})
			.resolvesOnce({
				Contents: [{ Key: "accounts/cfg-1/p2.eml" }],
				IsTruncated: false,
			});
		s3Mock.on(DeleteObjectsCommand).resolves({});

		await handleDeleteAccountObjects(event, noopLogger, workerQueuesOn(queue));

		const listCalls = s3Mock.commandCalls(ListObjectsV2Command);
		assert.equal(listCalls.length, 2);
		assert.equal(listCalls[1]?.args[0].input.ContinuationToken, "tok-2");
		assert.equal(s3Mock.commandCalls(DeleteObjectsCommand).length, 2);
	});

	it("skips the delete call when a page holds no keys", async () => {
		s3Mock.on(ListObjectsV2Command).resolves({ IsTruncated: false });

		await handleDeleteAccountObjects(event, noopLogger, workerQueuesOn(queue));

		assert.equal(s3Mock.commandCalls(DeleteObjectsCommand).length, 0);
	});

	it("re-enqueues with the continuation token when time is nearly up", async () => {
		s3Mock.on(ListObjectsV2Command).resolves({ IsTruncated: false });

		await handleDeleteAccountObjects(
			{ ...event, continuationToken: "tok-mid" },
			noopLogger,
			workerQueuesOn(queue),
			() => 5_000,
		);

		assert.equal(
			s3Mock.commandCalls(ListObjectsV2Command).length,
			0,
			"bails before starting a new page",
		);
		const body = queue.sent[0]?.body;
		assert.equal(body?.type, "DELETE_ACCOUNT_OBJECTS");
		assert.equal(body?.accountConfigId, "cfg-1");
		assert.equal(body?.continuationToken, "tok-mid");
	});

	it("keeps paging while time remains", async () => {
		s3Mock.on(ListObjectsV2Command).resolves({
			Contents: [{ Key: "accounts/cfg-1/x.eml" }],
			IsTruncated: false,
		});
		s3Mock.on(DeleteObjectsCommand).resolves({});

		await handleDeleteAccountObjects(
			event,
			noopLogger,
			workerQueuesOn(queue),
			() => 120_000,
		);

		assert.equal(s3Mock.commandCalls(ListObjectsV2Command).length, 1);
		assert.equal(queue.sent.length, 0);
	});
});
