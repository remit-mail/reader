import type { VectorStoreService } from "./backends/memory.js";
import type { EmbeddingService } from "./embeddings.js";
import { buildTextPreview } from "./search.js";
import type { ChunkType, VectorRecord } from "./types.js";

/**
 * The persisted anchor of a semantic filter (RFC 034 Decision 2.1). A single
 * mean-pooled snapshot of the anchor message's chunk vectors, plus the bounded
 * source text needed to re-embed it after a model migration (Decision 2.4).
 * Written once onto the sibling `FilterAnchor` row at filter-save time; never
 * re-derived per match.
 */
export interface AnchorPayload {
	anchorEmbedding: number[];
	anchorEmbeddingId: string;
	anchorSourceText: string;
}

/**
 * Mean-pool chunk vectors into one, then L2-normalize so the anchor is unit
 * length like the per-chunk vectors it summarizes (cosine is scale-invariant,
 * but a normalized anchor keeps the stored vector consistent with the chunk
 * vectors it was pooled from). Throws on an empty set or a dimension mismatch —
 * both are programmer errors the caller cannot recover from (let it crash).
 */
export const poolChunkVectors = (vectors: number[][]): number[] => {
	if (vectors.length === 0) {
		throw new Error("Cannot pool an empty set of chunk vectors");
	}
	const dimensions = vectors[0].length;
	const sum = new Array<number>(dimensions).fill(0);
	for (const vector of vectors) {
		if (vector.length !== dimensions) {
			throw new Error(
				`Chunk vector dimension mismatch: ${vector.length} vs ${dimensions}`,
			);
		}
		for (let i = 0; i < dimensions; i++) sum[i] += vector[i];
	}
	for (let i = 0; i < dimensions; i++) sum[i] /= vectors.length;

	let norm = 0;
	for (const value of sum) norm += value * value;
	norm = Math.sqrt(norm);
	if (norm === 0) return sum;
	return sum.map((value) => value / norm);
};

// The chunk types whose text carries the semantic meaning of "messages like
// this" — subject and body. Structured chunks (sender, recipient, attachment,
// entities) are excluded from the re-embeddable source text; they add no signal
// a user's plain-sentence anchor is about.
const SOURCE_TEXT_CHUNK_TYPES: readonly ChunkType[] = ["subject", "body"];

/**
 * Assemble the anchor's re-embeddable source text (RFC 034 Decision 2.4) from
 * the message's chunk previews, preferring subject then body. Falls back to
 * every available preview when the message has neither. Bounded by the same
 * `buildTextPreview` char/byte budget the chunk vectors already pay, so it never
 * exceeds the 512-char (and S3 Vectors byte) cap.
 */
export const buildAnchorSourceText = (
	chunks: Array<{ chunkType: ChunkType; textPreview?: string }>,
): string => {
	const previews: string[] = [];
	for (const type of SOURCE_TEXT_CHUNK_TYPES) {
		for (const chunk of chunks) {
			if (chunk.chunkType === type && chunk.textPreview) {
				previews.push(chunk.textPreview);
			}
		}
	}
	if (previews.length === 0) {
		for (const chunk of chunks) {
			if (chunk.textPreview) previews.push(chunk.textPreview);
		}
	}
	return buildTextPreview(previews.join("\n"));
};

export interface AnchorBuildDeps {
	store: Pick<VectorStoreService, "getByMessage">;
	embedder: Pick<EmbeddingService, "embeddingId">;
}

export interface AnchorBuildParams {
	accountConfigId: string;
	anchorMessageId: string;
}

/**
 * Build a filter's persisted anchor from the anchor message's already-indexed
 * chunk vectors (RFC 034 Decision 2.1). Reads the message's chunk vectors,
 * pools them into one, and derives the bounded source text — never embeds
 * anything new here; the vectors already exist from index time. Returns `null`
 * when the message has no indexed chunks, so the caller can decline to write a
 * `FilterAnchor` row (and leave `Filter.hasAnchor` false) rather than persist an
 * empty anchor.
 *
 * `anchorEmbeddingId` is the current embedder's identifier — the model the
 * chunk vectors were embedded under, which the indexing pipeline keeps current.
 */
export const buildMessageAnchor = async (
	deps: AnchorBuildDeps,
	params: AnchorBuildParams,
): Promise<AnchorPayload | null> => {
	const records = (await deps.store.getByMessage(params.anchorMessageId))
		.filter(
			(record: VectorRecord) =>
				record.metadata.accountConfigId === params.accountConfigId,
		)
		.sort((a: VectorRecord, b: VectorRecord) =>
			a.chunkId.localeCompare(b.chunkId),
		);
	if (records.length === 0) return null;

	return {
		anchorEmbedding: poolChunkVectors(records.map((r) => r.vector)),
		anchorEmbeddingId: deps.embedder.embeddingId,
		anchorSourceText: buildAnchorSourceText(
			records.map((r) => ({
				chunkType: r.metadata.chunkType,
				textPreview: r.metadata.textPreview,
			})),
		),
	};
};
