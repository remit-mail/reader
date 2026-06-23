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
import type { VectorRecord } from "../types.js";
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

	it("enumerates all keys when chunk listing spans more than the old 50-page limit", async () => {
		// Simulate 51 pages (each with one key), more than the old MAX_LIST_PAGES=50.
		// The fix must enumerate all keys without throwing.
		const PAGE_COUNT = 51;
		let call = 0;
		s3vMock.on(ListVectorsCommand).callsFake(() => {
			const page = call++;
			const isLast = page === PAGE_COUNT - 1;
			return {
				vectors: [{ key: `${MESSAGE_ID}::body-${page}` }],
				nextToken: isLast ? undefined : `tok-${page}`,
			};
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
			PAGE_COUNT,
			`should issue ${PAGE_COUNT} ListVectors calls`,
		);
		const allDeleted = deleted.flat().sort();
		assert.equal(
			allDeleted.length,
			PAGE_COUNT,
			"all keys from all pages must be deleted",
		);
		for (let i = 0; i < PAGE_COUNT; i++) {
			assert.ok(
				allDeleted.includes(`${MESSAGE_ID}::body-${i}`),
				`key body-${i} must be deleted`,
			);
		}
	});

	it("throws when pagination exceeds the safety bound (runaway malformed response)", async () => {
		// Always return a nextToken so pagination never terminates naturally.
		// This simulates a malformed S3 response; the safety bound must fire loudly.
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

describe("S3VectorsBackend.upsert batching", () => {
	let s3vMock: AwsClientStub<S3VectorsClient>;

	beforeEach(() => {
		s3vMock = mockClient(S3VectorsClient);
	});

	afterEach(() => {
		s3vMock.restore();
	});

	const buildVectors = (count: number): VectorRecord[] =>
		Array.from({ length: count }, (_, i) => ({
			chunkId: `${MESSAGE_ID}::body-${i}`,
			vector: [0.1, 0.2, 0.3],
			metadata: {
				messageId: MESSAGE_ID,
				threadId: "thread-1",
				accountConfigId: "acct-1",
				mailboxIds: ["mb-inbox"],
				chunkType: "body",
				sentDate: 1_700_000_000,
				isRead: false,
				hasAttachment: false,
				hasStars: false,
			},
		}));

	it("splits a >500-vector group into multiple PutVectors calls under the AWS cap", async () => {
		s3vMock.on(PutVectorsCommand).resolves({});

		await buildBackend().upsert(buildVectors(250));

		const putCalls = s3vMock.commandCalls(PutVectorsCommand);
		assert.equal(putCalls.length, 3, "250 vectors should split into 3 calls");
		const sizes = putCalls.map((c) => (c.args[0].input.vectors ?? []).length);
		assert.deepEqual(sizes, [100, 100, 50]);
		for (const size of sizes) {
			assert.ok(size <= 500, "no call exceeds the AWS 500/call cap");
		}
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

describe("S3VectorsBackend.upsert metadata flattening", () => {
	let s3vMock: AwsClientStub<S3VectorsClient>;

	beforeEach(() => {
		s3vMock = mockClient(S3VectorsClient);
	});

	afterEach(() => {
		s3vMock.restore();
	});

	const baseMetadata: VectorRecord["metadata"] = {
		messageId: MESSAGE_ID,
		threadId: "thread-1",
		accountConfigId: "acct-1",
		mailboxIds: ["mb-inbox"],
		chunkType: "sender",
		sentDate: 1_700_000_000,
		isRead: false,
		hasAttachment: false,
		hasStars: false,
	};

	const upsertedMetadata = async (
		metadata: VectorRecord["metadata"],
	): Promise<Record<string, unknown>> => {
		s3vMock.on(PutVectorsCommand).resolves({});
		await buildBackend().upsert([
			{ chunkId: `${MESSAGE_ID}::sender`, vector: [0.1, 0.2, 0.3], metadata },
		]);
		const putCalls = s3vMock.commandCalls(PutVectorsCommand);
		assert.equal(putCalls.length, 1);
		const sent = putCalls[0].args[0].input.vectors?.[0]?.metadata;
		assert.ok(sent && typeof sent === "object" && !Array.isArray(sent));
		return sent as Record<string, unknown>;
	};

	const assertS3VectorsSafe = (meta: Record<string, unknown>): void => {
		for (const [key, value] of Object.entries(meta)) {
			if (Array.isArray(value)) {
				for (const item of value) {
					assert.ok(
						typeof item === "string" ||
							typeof item === "number" ||
							typeof item === "boolean",
						`array element of ${key} must be a scalar, got ${typeof item}`,
					);
				}
				continue;
			}
			assert.ok(
				value === null ||
					typeof value === "string" ||
					typeof value === "number" ||
					typeof value === "boolean",
				`${key} must be a scalar, got ${typeof value}`,
			);
		}
	};

	it("flattens an object-valued sender to a display string", async () => {
		// Reproduces the dead-letter case: an older producer wrote `sender` as an
		// address object, which S3 Vectors rejects as a non-scalar.
		const metadata = {
			...baseMetadata,
			sender: { name: "Alice", email: "alice@example.com" },
		} as unknown as VectorRecord["metadata"];

		const sent = await upsertedMetadata(metadata);

		assert.equal(sent.sender, "Alice <alice@example.com>");
		assertS3VectorsSafe(sent);
	});

	it("flattens an array of address objects to an array of strings", async () => {
		const metadata = {
			...baseMetadata,
			sender: [
				{ name: "Alice", mailbox: "alice", host: "example.com" },
				{ mailbox: "bob", host: "example.com" },
			],
		} as unknown as VectorRecord["metadata"];

		const sent = await upsertedMetadata(metadata);

		assert.deepEqual(sent.sender, [
			"Alice <alice@example.com>",
			"bob@example.com",
		]);
		assertS3VectorsSafe(sent);
	});

	it("keeps clean scalar metadata unchanged and S3-Vectors-safe", async () => {
		const metadata: VectorRecord["metadata"] = {
			...baseMetadata,
			fileTypes: ["pdf", "png"],
			fromName: null,
			subject: "Q1 invoice review",
		};

		const sent = await upsertedMetadata(metadata);

		assert.equal(sent.messageId, MESSAGE_ID);
		assert.deepEqual(sent.mailboxIds, ["mb-inbox"]);
		assert.deepEqual(sent.fileTypes, ["pdf", "png"]);
		assert.equal(sent.fromName, null);
		assert.equal(sent.subject, "Q1 invoice review");
		assertS3VectorsSafe(sent);
	});
});
