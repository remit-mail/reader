import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
	DeleteVectorsCommand,
	PutVectorsCommand,
	QueryVectorsCommand,
	S3VectorsClient,
} from "@aws-sdk/client-s3vectors";
import { type AwsClientStub, mockClient } from "aws-sdk-client-mock";
import { candidateChunkKeys } from "../chunking/keys.js";
import type { VectorQuery, VectorRecord } from "../types.js";
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

describe("S3VectorsBackend.delete (deterministic keys, no index scan)", () => {
	let s3vMock: AwsClientStub<S3VectorsClient>;

	beforeEach(() => {
		s3vMock = mockClient(S3VectorsClient);
	});

	afterEach(() => {
		s3vMock.restore();
	});

	it("deletes the message's deterministic keys without ever listing the index", async () => {
		const deleted: string[][] = [];
		s3vMock.on(DeleteVectorsCommand).callsFake((input) => {
			deleted.push((input.keys ?? []) as string[]);
			return {};
		});

		await buildBackend().delete({ messageId: MESSAGE_ID });

		assert.deepEqual(
			deleted.flat().sort(),
			[...candidateChunkKeys(MESSAGE_ID)].sort(),
			"delete must address exactly the message's candidate key set",
		);
		for (const key of deleted.flat()) {
			assert.ok(
				key.startsWith(`${MESSAGE_ID}::`),
				`every deleted key must belong to the message, got ${key}`,
			);
		}
	});

	it("covers structured, body, and entity chunk keys", async () => {
		const deleted: string[][] = [];
		s3vMock.on(DeleteVectorsCommand).callsFake((input) => {
			deleted.push((input.keys ?? []) as string[]);
			return {};
		});

		await buildBackend().delete({ messageId: MESSAGE_ID });

		const all = new Set(deleted.flat());
		for (const suffix of ["sender", "subject", "body-0", "entities"]) {
			assert.ok(
				all.has(`${MESSAGE_ID}::${suffix}`),
				`candidate keys must include ${suffix}`,
			);
		}
	});

	it("batches deletes under the AWS 500-keys-per-call cap", async () => {
		s3vMock.on(DeleteVectorsCommand).resolves({});

		await buildBackend().delete({ messageId: MESSAGE_ID });

		const calls = s3vMock.commandCalls(DeleteVectorsCommand);
		assert.ok(
			calls.length >= 1,
			"should issue at least one DeleteVectors call",
		);
		for (const call of calls) {
			const keys = call.args[0].input.keys ?? [];
			assert.ok(keys.length <= 500, "no call exceeds the AWS 500/call cap");
		}
	});

	it("never issues a QueryVectors call (regression: no per-message ranking lookup)", async () => {
		s3vMock.on(DeleteVectorsCommand).resolves({});

		await buildBackend().delete({ messageId: MESSAGE_ID });

		assert.equal(
			s3vMock.commandCalls(QueryVectorsCommand).length,
			0,
			"delete must not use QueryVectors",
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

describe("S3VectorsBackend.query filter expression", () => {
	let s3vMock: AwsClientStub<S3VectorsClient>;

	beforeEach(() => {
		s3vMock = mockClient(S3VectorsClient);
	});

	afterEach(() => {
		s3vMock.restore();
	});

	const filterFor = async (filter: VectorQuery["filter"]): Promise<unknown> => {
		s3vMock.resetHistory();
		s3vMock.on(QueryVectorsCommand).resolves({
			vectors: [],
			distanceMetric: "cosine",
		});
		await buildBackend().query({ vector: [0.1, 0.2, 0.3], topK: 10, filter });
		const calls = s3vMock.commandCalls(QueryVectorsCommand);
		assert.equal(calls.length, 1);
		return calls[0].args[0].input.filter;
	};

	it("emits a bare single-key object for a single condition (no $and)", async () => {
		const emitted = await filterFor({ accountConfigId: "acct-1" });
		assert.deepEqual(emitted, { accountConfigId: "acct-1" });
	});

	it("wraps two conditions in $and, one single-key object each", async () => {
		const emitted = await filterFor({
			accountConfigId: "acct-1",
			mailboxId: "mb-inbox",
		});
		assert.deepEqual(emitted, {
			$and: [
				{ accountConfigId: "acct-1" },
				{ mailboxIds: { $in: ["mb-inbox"] } },
			],
		});
	});

	it("wraps two scalar conditions in $and", async () => {
		const emitted = await filterFor({
			accountConfigId: "acct-1",
			hasStars: true,
		});
		assert.deepEqual(emitted, {
			$and: [{ accountConfigId: "acct-1" }, { hasStars: true }],
		});
	});

	it("emits no filter for zero conditions", async () => {
		assert.equal(await filterFor(undefined), undefined);
		assert.equal(await filterFor({}), undefined);
	});

	it("emits the inbox Related shape as $and (regression for the Invalid filter 500)", async () => {
		// The inbox "Related" section always filters by account + mailbox. As a
		// flat 2-key object S3 Vectors rejects it with ValidationException, leaving
		// the section permanently empty. It must be wrapped in $and.
		const emitted = await filterFor({
			accountConfigId: "acct-1",
			mailboxId: "mb-inbox",
		});
		assert.ok(
			emitted !== null &&
				typeof emitted === "object" &&
				"$and" in (emitted as Record<string, unknown>),
			"multi-condition inbox filter must be wrapped in $and",
		);
		assert.deepEqual(emitted, {
			$and: [
				{ accountConfigId: "acct-1" },
				{ mailboxIds: { $in: ["mb-inbox"] } },
			],
		});
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
				typeof value === "string" ||
					typeof value === "number" ||
					typeof value === "boolean",
				`${key} must be a scalar, got ${value === null ? "null" : typeof value}`,
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
		assert.equal(sent.subject, "Q1 invoice review");
		assertS3VectorsSafe(sent);
	});

	it("omits a null-valued key rather than emitting null", async () => {
		// S3 Vectors rejects null metadata values. A sender with no display name
		// (fromName: null) must drop the key entirely, not send fromName: null.
		const metadata: VectorRecord["metadata"] = {
			...baseMetadata,
			fromName: null,
			subject: "Q1 invoice review",
		};

		const sent = await upsertedMetadata(metadata);

		assert.ok(!("fromName" in sent), "fromName key must be omitted when null");
		assert.equal(sent.subject, "Q1 invoice review");
		assertS3VectorsSafe(sent);
	});
});
