import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildAnchorSourceText,
	buildMessageAnchor,
	poolChunkVectors,
} from "./anchor.js";
import { createMemoryVectorStore } from "./backends/memory.js";
import { createDeterministicEmbeddingService } from "./embeddings.js";
import type { ChunkMetadata, VectorRecord } from "./types.js";

const l2Norm = (vector: number[]): number =>
	Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

const baseMetadata = (
	overrides: Partial<ChunkMetadata> = {},
): ChunkMetadata => ({
	messageId: "msg-1",
	threadId: "thread-1",
	accountConfigId: "acct-1",
	mailboxIds: ["mbox-1"],
	chunkType: "body",
	sentDate: 1_700_000_000,
	isRead: false,
	hasAttachment: false,
	hasStars: false,
	...overrides,
});

describe("poolChunkVectors", () => {
	it("mean-pools chunk vectors and L2-normalizes the result", () => {
		const pooled = poolChunkVectors([
			[2, 0, 0],
			[0, 2, 0],
		]);
		// Mean is [1, 1, 0]; normalized to unit length.
		assert.ok(Math.abs(l2Norm(pooled) - 1) < 1e-9);
		assert.ok(Math.abs(pooled[0] - pooled[1]) < 1e-9);
		assert.ok(Math.abs(pooled[2]) < 1e-9);
	});

	it("returns the single vector's direction when pooling one chunk", () => {
		const pooled = poolChunkVectors([[3, 4]]);
		assert.ok(Math.abs(pooled[0] - 0.6) < 1e-9);
		assert.ok(Math.abs(pooled[1] - 0.8) < 1e-9);
	});

	it("returns a zero vector unchanged rather than dividing by a zero norm", () => {
		assert.deepEqual(poolChunkVectors([[0, 0, 0]]), [0, 0, 0]);
	});

	it("throws on an empty set", () => {
		assert.throws(() => poolChunkVectors([]), /empty set/);
	});

	it("throws on a dimension mismatch", () => {
		assert.throws(
			() =>
				poolChunkVectors([
					[1, 2, 3],
					[1, 2],
				]),
			/dimension mismatch/,
		);
	});
});

describe("buildAnchorSourceText", () => {
	it("prefers subject then body previews", () => {
		const text = buildAnchorSourceText([
			{ chunkType: "body", textPreview: "the body" },
			{ chunkType: "subject", textPreview: "the subject" },
			{ chunkType: "sender", textPreview: "someone@example.com" },
		]);
		assert.equal(text, "the subject\nthe body");
	});

	it("falls back to every preview when there is no subject or body", () => {
		const text = buildAnchorSourceText([
			{ chunkType: "sender", textPreview: "someone@example.com" },
			{ chunkType: "entities", textPreview: "ACME Corp" },
		]);
		assert.equal(text, "someone@example.com\nACME Corp");
	});

	it("never exceeds the 512-char preview bound", () => {
		const long = "x".repeat(5000);
		const text = buildAnchorSourceText([
			{ chunkType: "body", textPreview: long },
		]);
		assert.ok(text.length <= 512);
	});
});

describe("buildMessageAnchor", () => {
	const embedder = createDeterministicEmbeddingService({ dimensions: 8 });

	const putRecord = async (
		store: ReturnType<typeof createMemoryVectorStore>,
		record: VectorRecord,
	): Promise<void> => store.upsert([record]);

	it("pools a message's chunk vectors and derives the anchor payload", async () => {
		const store = createMemoryVectorStore();
		await putRecord(store, {
			chunkId: "msg-1::subject",
			vector: [1, 0, 0, 0, 0, 0, 0, 0],
			metadata: baseMetadata({
				chunkType: "subject",
				textPreview: "booking confirmed",
			}),
		});
		await putRecord(store, {
			chunkId: "msg-1::body-0",
			vector: [0, 1, 0, 0, 0, 0, 0, 0],
			metadata: baseMetadata({
				chunkType: "body",
				textPreview: "your trip is booked",
			}),
		});

		const anchor = await buildMessageAnchor(
			{ store, embedder },
			{ accountConfigId: "acct-1", anchorMessageId: "msg-1" },
		);

		assert.ok(anchor);
		assert.equal(anchor.anchorEmbeddingId, embedder.embeddingId);
		assert.equal(anchor.anchorEmbedding.length, 8);
		assert.ok(Math.abs(l2Norm(anchor.anchorEmbedding) - 1) < 1e-9);
		assert.equal(
			anchor.anchorSourceText,
			"booking confirmed\nyour trip is booked",
		);
	});

	it("returns null when the message has no indexed chunks", async () => {
		const store = createMemoryVectorStore();
		const anchor = await buildMessageAnchor(
			{ store, embedder },
			{ accountConfigId: "acct-1", anchorMessageId: "absent" },
		);
		assert.equal(anchor, null);
	});

	it("ignores chunks belonging to another account", async () => {
		const store = createMemoryVectorStore();
		await putRecord(store, {
			chunkId: "msg-1::subject",
			vector: [1, 0, 0, 0, 0, 0, 0, 0],
			metadata: baseMetadata({
				chunkType: "subject",
				accountConfigId: "other-acct",
				textPreview: "not mine",
			}),
		});

		const anchor = await buildMessageAnchor(
			{ store, embedder },
			{ accountConfigId: "acct-1", anchorMessageId: "msg-1" },
		);
		assert.equal(anchor, null);
	});
});
