import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	DeleteObjectsCommand,
	ListObjectsV2Command,
	S3Client,
} from "@aws-sdk/client-s3";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { Logger } from "@remit/logger-lambda";
import { mockClient } from "aws-sdk-client-mock";
import {
	type DeleteAccountObjectsEvent,
	handleDeleteAccountObjects,
} from "./delete-account-objects.js";

const noopLog = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
	fatal: () => {},
	trace: () => {},
	child: () => noopLog,
} as unknown as Logger;

const s3Mock = mockClient(S3Client);
const sqsMock = mockClient(SQSClient);

const event: DeleteAccountObjectsEvent = {
	type: "DELETE_ACCOUNT_OBJECTS",
	accountConfigId: "cfg-1",
};

describe("handleDeleteAccountObjects", () => {
	afterEach(() => {
		s3Mock.reset();
		sqsMock.reset();
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

		await handleDeleteAccountObjects(event, noopLog);

		const listCall = s3Mock.commandCalls(ListObjectsV2Command)[0];
		assert.equal(listCall.args[0].input.Prefix, "accounts/cfg-1/");

		const deleteCall = s3Mock.commandCalls(DeleteObjectsCommand)[0];
		assert.deepEqual(deleteCall.args[0].input.Delete?.Objects, [
			{ Key: "accounts/cfg-1/a.eml" },
			{ Key: "accounts/cfg-1/b.eml" },
		]);
		assert.equal(sqsMock.commandCalls(SendMessageCommand).length, 0);
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

		await handleDeleteAccountObjects(event, noopLog);

		const listCalls = s3Mock.commandCalls(ListObjectsV2Command);
		assert.equal(listCalls.length, 2);
		assert.equal(listCalls[1]?.args[0].input.ContinuationToken, "tok-2");
		assert.equal(s3Mock.commandCalls(DeleteObjectsCommand).length, 2);
	});

	it("skips the delete call when a page holds no keys", async () => {
		s3Mock.on(ListObjectsV2Command).resolves({ IsTruncated: false });

		await handleDeleteAccountObjects(event, noopLog);

		assert.equal(s3Mock.commandCalls(DeleteObjectsCommand).length, 0);
	});

	it("re-enqueues with the continuation token when time is nearly up", async () => {
		s3Mock.on(ListObjectsV2Command).resolves({ IsTruncated: false });
		sqsMock.on(SendMessageCommand).resolves({});

		await handleDeleteAccountObjects(
			{ ...event, continuationToken: "tok-mid" },
			noopLog,
			() => 5_000,
		);

		assert.equal(
			s3Mock.commandCalls(ListObjectsV2Command).length,
			0,
			"bails before starting a new page",
		);
		const send = sqsMock.commandCalls(SendMessageCommand)[0];
		const body = JSON.parse(
			send?.args[0].input.MessageBody ?? "{}",
		) as DeleteAccountObjectsEvent;
		assert.equal(body.type, "DELETE_ACCOUNT_OBJECTS");
		assert.equal(body.accountConfigId, "cfg-1");
		assert.equal(body.continuationToken, "tok-mid");
	});

	it("keeps paging while time remains", async () => {
		s3Mock.on(ListObjectsV2Command).resolves({
			Contents: [{ Key: "accounts/cfg-1/x.eml" }],
			IsTruncated: false,
		});
		s3Mock.on(DeleteObjectsCommand).resolves({});

		await handleDeleteAccountObjects(event, noopLog, () => 120_000);

		assert.equal(s3Mock.commandCalls(ListObjectsV2Command).length, 1);
		assert.equal(sqsMock.commandCalls(SendMessageCommand).length, 0);
	});
});
