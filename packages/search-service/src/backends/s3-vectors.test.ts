import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
	DeleteVectorsCommand,
	ListVectorsCommand,
	PutVectorsCommand,
	QueryVectorsCommand,
	S3VectorsClient,
} from "@aws-sdk/client-s3vectors";
import { type AwsClientStub, mockClient } from "aws-sdk-client-mock";
import { S3VectorsBackend } from "./s3-vectors.js";

const VECTOR_BUCKET = "test-vector-bucket";
const INDEX_NAME = "test-index";
const MESSAGE_ID = "msg-abc";

const buildBackend = () =>
	new S3VectorsBackend({
		client: new S3VectorsClient({ region: "us-east-1" }),
		vectorBucketName: VECTOR_BUCKET,
		indexName: INDEX_NAME,
	});

const keysForMessage = (messageId: string, suffixes: string[]) =>
	suffixes.map((s) => ({ key: `${messageId}::${s}` }));

describe("S3VectorsBackend.findChunkKeysForMessage (via delete)", () => {
	let s3vMock: AwsClientStub<S3VectorsClient>;

	beforeEach(() => {
		s3vMock = mockClient(S3VectorsClient);
	});

	afterEach(() => {
		s3vMock.restore();
	});

	it("returns keys directly from a single-page ListVectors response", async () => {
		s3vMock.on(ListVectorsCommand).resolves({
			vectors: keysForMessage(MESSAGE_ID, ["body-0", "subject", "sender"]),
			nextToken: undefined,
		});
		const deleted: string[][] = [];
		s3vMock.on(DeleteVectorsCommand).callsFake((input) => {
			deleted.push((input.keys ?? []) as string[]);
			return {};
		});

		await buildBackend().delete({ messageId: MESSAGE_ID });

		const listCalls = s3vMock.commandCalls(ListVectorsCommand);
		assert.equal(
			listCalls.length,
			1,
			"should issue exactly one ListVectors call",
		);
		assert.deepEqual(deleted.flat().sort(), [
			`${MESSAGE_ID}::body-0`,
			`${MESSAGE_ID}::sender`,
			`${MESSAGE_ID}::subject`,
		]);
	});

	it("paginates over nextToken and returns the union of pages", async () => {
		s3vMock
			.on(ListVectorsCommand)
			.resolvesOnce({
				vectors: keysForMessage(MESSAGE_ID, ["body-0", "body-1"]),
				nextToken: "tok-1",
			})
			.resolvesOnce({
				vectors: keysForMessage(MESSAGE_ID, ["body-2", "entities"]),
				nextToken: "tok-2",
			})
			.resolvesOnce({
				vectors: keysForMessage(MESSAGE_ID, ["subject"]),
				nextToken: undefined,
			});
		const deleted: string[][] = [];
		s3vMock.on(DeleteVectorsCommand).callsFake((input) => {
			deleted.push((input.keys ?? []) as string[]);
			return {};
		});

		await buildBackend().delete({ messageId: MESSAGE_ID });

		const listCalls = s3vMock.commandCalls(ListVectorsCommand);
		assert.equal(listCalls.length, 3, "should paginate across three pages");
		assert.equal(listCalls[0].args[0].input.nextToken, undefined);
		assert.equal(listCalls[1].args[0].input.nextToken, "tok-1");
		assert.equal(listCalls[2].args[0].input.nextToken, "tok-2");
		assert.deepEqual(deleted.flat().sort(), [
			`${MESSAGE_ID}::body-0`,
			`${MESSAGE_ID}::body-1`,
			`${MESSAGE_ID}::body-2`,
			`${MESSAGE_ID}::entities`,
			`${MESSAGE_ID}::subject`,
		]);
	});

	it("filters out vectors belonging to other messages by key prefix", async () => {
		s3vMock.on(ListVectorsCommand).resolves({
			vectors: [
				{ key: `${MESSAGE_ID}::body-0` },
				{ key: "msg-other::body-0" },
				{ key: `${MESSAGE_ID}::subject` },
				{ key: "msg-other::subject" },
			],
			nextToken: undefined,
		});
		const deleted: string[][] = [];
		s3vMock.on(DeleteVectorsCommand).callsFake((input) => {
			deleted.push((input.keys ?? []) as string[]);
			return {};
		});

		await buildBackend().delete({ messageId: MESSAGE_ID });

		assert.deepEqual(deleted.flat().sort(), [
			`${MESSAGE_ID}::body-0`,
			`${MESSAGE_ID}::subject`,
		]);
	});

	it("skips DeleteVectors entirely when no keys match", async () => {
		s3vMock.on(ListVectorsCommand).resolves({
			vectors: [{ key: "msg-other::body-0" }],
			nextToken: undefined,
		});
		s3vMock.on(DeleteVectorsCommand).resolves({});

		await buildBackend().delete({ messageId: MESSAGE_ID });

		assert.equal(
			s3vMock.commandCalls(DeleteVectorsCommand).length,
			0,
			"should not call DeleteVectors when there are no matching keys",
		);
	});

	it("throws when pagination exceeds the safety bound", async () => {
		// Always return a nextToken so pagination never terminates naturally.
		s3vMock.on(ListVectorsCommand).callsFake(() => ({
			vectors: [{ key: `${MESSAGE_ID}::body-0` }],
			nextToken: "never-ends",
		}));
		s3vMock.on(DeleteVectorsCommand).resolves({});

		await assert.rejects(
			buildBackend().delete({ messageId: MESSAGE_ID }),
			/exceeded MAX_LIST_PAGES/,
		);
	});

	it("never sends a QueryVectors call from findChunkKeysForMessage (regression guard for topK > 100)", async () => {
		s3vMock.on(ListVectorsCommand).resolves({
			vectors: keysForMessage(MESSAGE_ID, ["body-0"]),
			nextToken: undefined,
		});
		s3vMock.on(DeleteVectorsCommand).resolves({});

		await buildBackend().delete({ messageId: MESSAGE_ID });

		const queryCalls = s3vMock.commandCalls(QueryVectorsCommand);
		assert.equal(
			queryCalls.length,
			0,
			"findChunkKeysForMessage must use ListVectors, not QueryVectors (topK is capped at 100)",
		);
	});
});

describe("S3VectorsBackend.deleteKeys", () => {
	let s3vMock: AwsClientStub<S3VectorsClient>;

	beforeEach(() => {
		s3vMock = mockClient(S3VectorsClient);
	});

	afterEach(() => {
		s3vMock.restore();
	});

	it("calls DeleteVectorsCommand with exactly those keys and no ListVectorsCommand", async () => {
		const deleted: string[][] = [];
		s3vMock.on(DeleteVectorsCommand).callsFake((input) => {
			deleted.push((input.keys ?? []) as string[]);
			return {};
		});

		const keys = [`${MESSAGE_ID}::subject`, `${MESSAGE_ID}::body-0`];
		await buildBackend().deleteKeys(keys);

		assert.equal(
			s3vMock.commandCalls(ListVectorsCommand).length,
			0,
			"deleteKeys must not issue any ListVectors call",
		);
		assert.deepEqual(deleted.flat().sort(), [...keys].sort());
	});

	it("batches 600 keys into 2 DeleteVectorsCommand calls at batch size 500", async () => {
		const deleted: string[][] = [];
		s3vMock.on(DeleteVectorsCommand).callsFake((input) => {
			deleted.push((input.keys ?? []) as string[]);
			return {};
		});

		const keys = Array.from(
			{ length: 600 },
			(_, i) => `${MESSAGE_ID}::chunk-${i}`,
		);
		await buildBackend().deleteKeys(keys);

		assert.equal(
			s3vMock.commandCalls(DeleteVectorsCommand).length,
			2,
			"600 keys should be split into 2 batches of 500 and 100",
		);
		assert.equal(deleted[0].length, 500);
		assert.equal(deleted[1].length, 100);
	});

	it("does nothing when keys array is empty", async () => {
		s3vMock.on(DeleteVectorsCommand).resolves({});

		await buildBackend().deleteKeys([]);

		assert.equal(s3vMock.commandCalls(DeleteVectorsCommand).length, 0);
	});
});

describe("S3VectorsBackend PUT batch size", () => {
	let s3vMock: AwsClientStub<S3VectorsClient>;

	beforeEach(() => {
		s3vMock = mockClient(S3VectorsClient);
	});

	afterEach(() => {
		s3vMock.restore();
	});

	it("batches 600 vectors into 2 PutVectorsCommand calls at batch size 500", async () => {
		const batches: number[] = [];
		s3vMock.on(PutVectorsCommand).callsFake((input) => {
			batches.push((input.vectors ?? []).length);
			return {};
		});

		const vectors = Array.from({ length: 600 }, (_, i) => ({
			chunkId: `${MESSAGE_ID}::chunk-${i}`,
			vector: [0.1, 0.2, 0.3],
			metadata: {
				messageId: MESSAGE_ID,
				threadId: "thread-1",
				accountConfigId: "acct-1",
				mailboxIds: ["mb-inbox"],
				chunkType: "body" as const,
				sentDate: 1_700_000_000,
				isRead: false,
				hasAttachment: false,
				hasStars: false,
			},
		}));

		await buildBackend().upsert(vectors);

		assert.equal(
			s3vMock.commandCalls(PutVectorsCommand).length,
			2,
			"600 vectors should be split into 2 batches of 500 and 100",
		);
		assert.equal(batches[0], 500);
		assert.equal(batches[1], 100);
	});
});

describe("S3VectorsBackend.query topK guard", () => {
	let s3vMock: AwsClientStub<S3VectorsClient>;

	beforeEach(() => {
		s3vMock = mockClient(S3VectorsClient);
	});

	afterEach(() => {
		s3vMock.restore();
	});

	it("forwards topK to QueryVectorsCommand (caller is responsible for staying within the AWS 1..100 limit)", async () => {
		s3vMock.on(QueryVectorsCommand).resolves({
			vectors: [],
			distanceMetric: "cosine",
		});

		await buildBackend().query({ vector: [0.1, 0.2, 0.3], topK: 100 });

		const calls = s3vMock.commandCalls(QueryVectorsCommand);
		assert.equal(calls.length, 1);
		const topK = calls[0].args[0].input.topK;
		assert.equal(topK, 100, "topK should be passed through unchanged");
		assert.ok(
			topK !== undefined && topK >= 1 && topK <= 100,
			`topK must be within AWS S3 Vectors 1..100 range, got ${topK}`,
		);
	});
});

describe("S3VectorsBackend.query metadata backward-compat (no reindex)", () => {
	let s3vMock: AwsClientStub<S3VectorsClient>;

	beforeEach(() => {
		s3vMock = mockClient(S3VectorsClient);
	});

	afterEach(() => {
		s3vMock.restore();
	});

	// Legacy metadata shape: indexed before display-field enrichment, so it
	// omits fromName and subject. The strict toMetadata() parser must accept
	// this without throwing so pre-enrichment vectors keep working with no
	// bulk reindex required.
	const legacyMetadata = {
		messageId: MESSAGE_ID,
		threadId: "thread-1",
		accountConfigId: "acct-1",
		mailboxIds: ["mb-inbox"],
		chunkType: "subject",
		sentDate: 1_700_000_000,
		isRead: false,
		hasAttachment: false,
		hasStars: false,
	};

	it("parses legacy metadata that omits fromName/subject without throwing", async () => {
		s3vMock.on(QueryVectorsCommand).resolves({
			vectors: [
				{
					key: `${MESSAGE_ID}::subject`,
					distance: 0.1,
					metadata: legacyMetadata,
				},
			],
			distanceMetric: "cosine",
		});

		const matches = await buildBackend().query({
			vector: [0.1, 0.2, 0.3],
			topK: 10,
		});

		assert.equal(matches.length, 1);
		const meta = matches[0].metadata;
		// Display fields simply absent — not blank strings, not an error.
		assert.equal(meta.fromName, undefined);
		assert.equal(meta.subject, undefined);
		// Pre-existing fields still parse.
		assert.equal(meta.messageId, MESSAGE_ID);
		assert.equal(meta.sentDate, 1_700_000_000);
	});

	it("parses metadata with fromName: null (sender has no display name)", async () => {
		s3vMock.on(QueryVectorsCommand).resolves({
			vectors: [
				{
					key: `${MESSAGE_ID}::subject`,
					distance: 0.1,
					metadata: {
						...legacyMetadata,
						fromName: null,
						subject: "Q1 invoice review",
					},
				},
			],
			distanceMetric: "cosine",
		});

		const matches = await buildBackend().query({
			vector: [0.1, 0.2, 0.3],
			topK: 10,
		});

		assert.equal(matches.length, 1);
		const meta = matches[0].metadata;
		assert.equal(meta.fromName, null);
		assert.equal(meta.subject, "Q1 invoice review");
	});

	it("parses enriched metadata with fromName and subject present", async () => {
		s3vMock.on(QueryVectorsCommand).resolves({
			vectors: [
				{
					key: `${MESSAGE_ID}::subject`,
					distance: 0.1,
					metadata: {
						...legacyMetadata,
						fromName: "Alice",
						subject: "Q1 invoice review",
					},
				},
			],
			distanceMetric: "cosine",
		});

		const matches = await buildBackend().query({
			vector: [0.1, 0.2, 0.3],
			topK: 10,
		});

		assert.equal(matches.length, 1);
		const meta = matches[0].metadata;
		assert.equal(meta.fromName, "Alice");
		assert.equal(meta.subject, "Q1 invoice review");
	});
});
