import type { VectorStoreService } from "./backends/memory.js";
import { createEmailChunker, type EmailChunker } from "./chunking/chunker.js";
import { extractAttachmentFileTypes } from "./chunking/structured.js";
import { computeContentHash } from "./content-hash.js";
import type { EmbeddingService } from "./embeddings.js";
import type {
	Chunk,
	ChunkMetadata,
	IndexEmailParams,
	SearchParams,
	SearchResult,
	VectorMatch,
	VectorRecord,
} from "./types.js";

/** Outcome of an upsert: how many vectors were written vs skipped as unchanged. */
export interface UpsertResult {
	upserted: number;
	skipped: number;
}

export interface UpsertOptions {
	/** Re-PUT every record regardless of content hash (deliberate full re-embed / repair). */
	force?: boolean;
}

export interface SearchService {
	index(params: IndexEmailParams): Promise<void>;
	prepareVectors(params: IndexEmailParams): Promise<VectorRecord[]>;
	upsertVectors(
		records: VectorRecord[],
		options?: UpsertOptions,
	): Promise<UpsertResult>;
	/**
	 * Chunk, then embed and upsert only the chunks whose content hash changed.
	 * The hash is computed from the chunk text before embedding, so an unchanged,
	 * already-indexed message costs one `existingContentHashes` lookup and no
	 * embedding. `force` re-embeds every chunk (move metadata refresh / repair).
	 *
	 * `{ upserted: 0, skipped: 0 }` means the message has no indexable content
	 * (no chunks); `{ upserted: 0, skipped: n>0 }` means everything was unchanged.
	 */
	indexIncremental(
		params: IndexEmailParams,
		options?: UpsertOptions,
	): Promise<UpsertResult>;
	search(params: SearchParams): Promise<SearchResult[]>;
	delete(messageId: string): Promise<void>;
}

const DEFAULT_TOP_K = 50;
const DEFAULT_LIMIT = 25;

const dedupeMatchesByMessage = (matches: VectorMatch[]): VectorMatch[] => {
	const best = new Map<string, VectorMatch>();
	for (const m of matches) {
		const existing = best.get(m.metadata.messageId);
		if (!existing || m.score > existing.score) {
			best.set(m.metadata.messageId, m);
		}
	}
	return Array.from(best.values()).sort((a, b) => b.score - a.score);
};

export interface SearchServiceConfig {
	chunker?: EmailChunker;
	embedder: EmbeddingService;
	store: VectorStoreService;
}

export class DefaultSearchService implements SearchService {
	private chunker: EmailChunker;
	private embedder: EmbeddingService;
	private store: VectorStoreService;

	constructor(config: SearchServiceConfig) {
		this.chunker = config.chunker ?? createEmailChunker();
		this.embedder = config.embedder;
		this.store = config.store;
	}

	index = async (params: IndexEmailParams): Promise<void> => {
		const records = await this.prepareVectors(params);
		if (records.length === 0) return;
		await this.upsertVectors(records);
	};

	prepareVectors = async (
		params: IndexEmailParams,
	): Promise<VectorRecord[]> => {
		const { envelope, parsedBody, metadata } = params;
		const chunks = this.chunker.chunk({
			envelope,
			parsedBody,
			messageId: metadata.messageId,
		});
		if (chunks.length === 0) return [];

		const vectors = await this.embedder.embed(chunks.map((c) => c.text));
		if (vectors.length !== chunks.length) {
			throw new Error(
				`Embedding count mismatch: ${vectors.length} vectors for ${chunks.length} chunks`,
			);
		}

		const fileTypes = extractAttachmentFileTypes(envelope.attachments);
		const { embeddingId } = this.embedder;

		return chunks.map((chunk, i) => {
			const meta: ChunkMetadata = {
				...metadata,
				chunkType: chunk.chunkType,
				contentHash: computeContentHash(embeddingId, chunk.text),
				...(chunk.chunkType === "attachment" && fileTypes.length > 0
					? { fileTypes }
					: {}),
			};
			return {
				chunkId: chunk.chunkId,
				vector: vectors[i],
				metadata: meta,
			};
		});
	};

	// Idempotent by contract: PUT a vector only when its content hash differs from
	// what is already stored. An unchanged re-index/backfill reads the existing
	// hashes (cheap GetVectors, addressed by deterministic key — never a scan) and
	// writes nothing. A content change or embedding-model bump changes the hash and
	// re-PUTs; `force` re-PUTs every record regardless.
	upsertVectors = async (
		records: VectorRecord[],
		options?: UpsertOptions,
	): Promise<UpsertResult> => {
		if (records.length === 0) return { upserted: 0, skipped: 0 };

		if (options?.force) {
			await this.store.upsert(records);
			return { upserted: records.length, skipped: 0 };
		}

		const existing = await this.store.existingContentHashes(
			records.map((r) => r.chunkId),
		);
		const changed = records.filter(
			(r) => existing.get(r.chunkId) !== r.metadata.contentHash,
		);

		if (changed.length > 0) await this.store.upsert(changed);
		return {
			upserted: changed.length,
			skipped: records.length - changed.length,
		};
	};

	indexIncremental = async (
		params: IndexEmailParams,
		options?: UpsertOptions,
	): Promise<UpsertResult> => {
		const { envelope, parsedBody, metadata } = params;
		const chunks = this.chunker.chunk({
			envelope,
			parsedBody,
			messageId: metadata.messageId,
		});
		if (chunks.length === 0) return { upserted: 0, skipped: 0 };

		const byId = new Map<string, Chunk>();
		for (const chunk of chunks) byId.set(chunk.chunkId, chunk);
		const unique = [...byId.values()];

		const { embeddingId } = this.embedder;
		const hashed = unique.map((chunk) => ({
			chunk,
			contentHash: computeContentHash(embeddingId, chunk.text),
		}));

		// Gate the embed on content hash. This is the whole point of the method:
		// a re-delivered event for an unchanged message reads the stored hashes
		// (cheap, keyed GetVectors) and returns without embedding anything.
		let toEmbed = hashed;
		if (!options?.force) {
			const existing = await this.store.existingContentHashes(
				unique.map((c) => c.chunkId),
			);
			toEmbed = hashed.filter(
				(h) => existing.get(h.chunk.chunkId) !== h.contentHash,
			);
		}
		const skipped = unique.length - toEmbed.length;
		if (toEmbed.length === 0) return { upserted: 0, skipped };

		const vectors = await this.embedder.embed(toEmbed.map((h) => h.chunk.text));
		if (vectors.length !== toEmbed.length) {
			throw new Error(
				`Embedding count mismatch: ${vectors.length} vectors for ${toEmbed.length} chunks`,
			);
		}

		const fileTypes = extractAttachmentFileTypes(envelope.attachments);
		const records: VectorRecord[] = toEmbed.map((h, i) => ({
			chunkId: h.chunk.chunkId,
			vector: vectors[i],
			metadata: {
				...metadata,
				chunkType: h.chunk.chunkType,
				contentHash: h.contentHash,
				...(h.chunk.chunkType === "attachment" && fileTypes.length > 0
					? { fileTypes }
					: {}),
			},
		}));
		await this.store.upsert(records);
		return { upserted: records.length, skipped };
	};

	search = async (params: SearchParams): Promise<SearchResult[]> => {
		const limit = params.limit ?? DEFAULT_LIMIT;
		const [queryVector] = await this.embedder.embed([params.query]);
		if (!queryVector) return [];

		const matches = await this.store.query({
			vector: queryVector,
			topK: Math.max(limit * 4, DEFAULT_TOP_K),
			filter: {
				accountConfigId: params.accountConfigId,
				mailboxId: params.mailboxId,
				sentDateRange: params.sentDateRange,
				hasAttachment: params.hasAttachment,
				hasStars: params.hasStars,
				isRead: params.isRead,
				category: params.category,
			},
		});

		const deduped = dedupeMatchesByMessage(matches).slice(0, limit);
		return deduped.map((m) => ({
			messageId: m.metadata.messageId,
			threadId: m.metadata.threadId,
			score: m.score,
			matchedChunkType: m.metadata.chunkType,
			mailboxIds: m.metadata.mailboxIds,
			sentDate: m.metadata.sentDate,
			...(m.metadata.fromName !== undefined
				? { fromName: m.metadata.fromName }
				: {}),
			...(m.metadata.subject !== undefined
				? { subject: m.metadata.subject }
				: {}),
			...(m.metadata.category !== undefined
				? { category: m.metadata.category }
				: {}),
		}));
	};

	delete = async (messageId: string): Promise<void> => {
		await this.store.delete({ messageId });
	};
}

export const createSearchService = (
	config: SearchServiceConfig,
): SearchService => new DefaultSearchService(config);
