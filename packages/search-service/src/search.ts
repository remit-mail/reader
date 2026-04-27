import type { VectorStoreService } from "./backends/memory.js";
import { createEmailChunker, type EmailChunker } from "./chunking/chunker.js";
import { extractAttachmentFileTypes } from "./chunking/structured.js";
import type { EmbeddingService } from "./embeddings.js";
import type {
	ChunkMetadata,
	IndexEmailParams,
	SearchParams,
	SearchResult,
	VectorMatch,
	VectorRecord,
} from "./types.js";

export interface SearchService {
	index(params: IndexEmailParams): Promise<void>;
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
		const { envelope, parsedBody, metadata } = params;
		const chunks = this.chunker.chunk({
			envelope,
			parsedBody,
			messageId: metadata.messageId,
		});
		if (chunks.length === 0) return;

		const vectors = await this.embedder.embed(chunks.map((c) => c.text));
		if (vectors.length !== chunks.length) {
			throw new Error(
				`Embedding count mismatch: ${vectors.length} vectors for ${chunks.length} chunks`,
			);
		}

		const fileTypes = extractAttachmentFileTypes(envelope.attachments);

		const records: VectorRecord[] = chunks.map((chunk, i) => {
			const meta: ChunkMetadata = {
				...metadata,
				chunkType: chunk.chunkType,
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

		await this.store.upsert(records);
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
			},
		});

		const deduped = dedupeMatchesByMessage(matches).slice(0, limit);
		return deduped.map((m) => ({
			messageId: m.metadata.messageId,
			threadId: m.metadata.threadId,
			score: m.score,
			matchedChunkType: m.metadata.chunkType,
			mailboxIds: m.metadata.mailboxIds,
		}));
	};

	delete = async (messageId: string): Promise<void> => {
		await this.store.delete({ messageId });
	};
}

export const createSearchService = (
	config: SearchServiceConfig,
): SearchService => new DefaultSearchService(config);
