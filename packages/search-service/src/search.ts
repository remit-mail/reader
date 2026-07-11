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

// S3 Vectors limits (docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-limitations.html,
// verified 2026-07): filterable metadata <= 2 KB/vector, total metadata <= 40 KB/vector.
// textPreview should be declared non-filterable via the index's
// metadataConfiguration.nonFilterableMetadataKeys (a CDK-level change) so it only counts
// against the 40 KB total budget; that is not planned (see PR description) — the byte-bounded
// preview below is the design, not an interim measure.
//
// Until then, textPreview shares the 2048 B filterable budget with every other ChunkMetadata
// field written alongside it in the same PutVectors call (see toMetadataDocument in
// backends/s3-vectors.ts). `slice(0, N)` on a JS string counts UTF-16 code units, not bytes —
// for CJK/Cyrillic/Arabic text (2-3 bytes/char in UTF-8) a 512-char preview alone can reach
// ~1.5 KB, leaving no room for the rest of the metadata and blowing the cap (PutVectors then
// rejects the whole vector, dead-lettering the message). The budget below is therefore a fixed
// byte cap, not a char cap.
//
// Worst-case JSON-serialized size of the other filterable fields (key + value + quoting/comma
// overhead), rounded up per field:
//
//   messageId, threadId, accountConfigId   3 UUIDs                      ~170 B
//   contentHash                            sha256 hex                    ~85 B
//   mailboxIds                             up to ~6 labels/UUIDs        ~250 B
//   chunkType, category                    short enum strings            ~50 B
//   sentDate, isRead, hasAttachment,
//     hasStars                             1 number + 3 booleans         ~70 B
//   fileTypes                              a handful of MIME types      ~110 B
//   fromName, subject                      display strings (unbounded
//                                           elsewhere in the system)    ~450 B
//                                                                     ---------
//                                                             total    ~1185 B
//
// subject/fromName/mailboxIds have no hard length limit upstream, so this is a realistic
// worst case, not a proof. OTHER_METADATA_MAX_BYTES rounds it up to 1300 B for headroom.
// SAFETY_MARGIN_BYTES shaves another 48 B off the 748 B remainder, landing on a round
// 700 B for textPreview — comfortably above what a 512-char ASCII preview needs (512 B,
// so the byte cap never shortens the common case) and enough for ~175 chars of 4-byte
// UTF-8 (emoji) or ~233 chars of 3-byte UTF-8 (CJK).
const TEXT_PREVIEW_MAX_CHARS = 512;
const S3_VECTORS_FILTERABLE_METADATA_MAX_BYTES = 2048;
const OTHER_METADATA_MAX_BYTES = 1300;
const SAFETY_MARGIN_BYTES = 48;
const TEXT_PREVIEW_MAX_BYTES =
	S3_VECTORS_FILTERABLE_METADATA_MAX_BYTES -
	OTHER_METADATA_MAX_BYTES -
	SAFETY_MARGIN_BYTES;

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

// Truncate `text` to at most `maxBytes` UTF-8 bytes without splitting a multi-byte
// sequence (or a surrogate pair, which encodes as one 4-byte UTF-8 sequence) —
// naive byte-slicing can cut mid-character and produce invalid UTF-8 / a broken
// glyph. Backs off at most 3 bytes (the longest UTF-8 sequence is 4 bytes) before
// landing on a valid boundary.
export const truncateUtf8Bytes = (text: string, maxBytes: number): string => {
	const bytes = Buffer.from(text, "utf8");
	if (bytes.byteLength <= maxBytes) return text;
	for (let len = maxBytes; len > 0; len--) {
		try {
			return utf8Decoder.decode(bytes.subarray(0, len));
		} catch {
			// Landed mid-sequence; back off one byte and retry.
		}
	}
	return "";
};

// Preview stored in vector metadata: bounded by char count (existing preview-length
// semantics) and, independently, by UTF-8 byte size (the S3 Vectors filterable
// metadata cap — see TEXT_PREVIEW_MAX_BYTES above). The byte cap only bites for
// multi-byte text; a 512-char ASCII preview is unaffected.
export const buildTextPreview = (text: string): string =>
	truncateUtf8Bytes(
		text.slice(0, TEXT_PREVIEW_MAX_CHARS),
		TEXT_PREVIEW_MAX_BYTES,
	);

// Blend weights for hybrid re-ranking: literal substring matches on the stored
// textPreview outweigh raw cosine similarity, so exact terms (invoice numbers,
// names, codes) surface over a merely-similar semantic neighbor.
const RERANK_COSINE_WEIGHT = 0.4;
const RERANK_LITERAL_WEIGHT = 0.6;

const QUERY_TOKEN_MIN_LENGTH = 3;
const QUERY_TOKEN_MAX_COUNT = 8;

export const tokenizeQuery = (query: string): string[] =>
	query
		.toLowerCase()
		.split(/\s+/)
		.filter((token) => token.length >= QUERY_TOKEN_MIN_LENGTH)
		.slice(0, QUERY_TOKEN_MAX_COUNT);

// Fraction of query tokens found as substrings in the chunk's textPreview.
// `undefined` means "no preview stored" (pre-rerank vector) — the caller must
// treat that as score-neutral, not as a literal score of 0. A query with no
// qualifying tokens (all shorter than QUERY_TOKEN_MIN_LENGTH) has no literal
// signal to compute either, so it is also treated as neutral.
export const literalMatchScore = (
	queryTokens: string[],
	textPreview: string | undefined,
): number | undefined => {
	if (textPreview === undefined) return undefined;
	if (queryTokens.length === 0) return undefined;
	const haystack = textPreview.toLowerCase();
	const hits = queryTokens.filter((token) => haystack.includes(token)).length;
	return hits / queryTokens.length;
};

// Blend cosine similarity with a literal-substring score computed from the
// chunk's textPreview. Applied to the full topK candidate window, before
// dedupe-by-message, so the literal boost can change which chunk represents a
// message. Vectors with no stored textPreview (written before this field
// existed) keep their raw cosine score unscaled — never penalized for missing
// a preview.
export const rerank = (
	matches: VectorMatch[],
	query: string,
): VectorMatch[] => {
	const queryTokens = tokenizeQuery(query);
	return matches.map((match) => {
		const literal = literalMatchScore(queryTokens, match.metadata.textPreview);
		if (literal === undefined) return match;
		return {
			...match,
			score:
				RERANK_COSINE_WEIGHT * match.score + RERANK_LITERAL_WEIGHT * literal,
		};
	});
};

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
				textPreview: buildTextPreview(chunk.text),
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
				textPreview: buildTextPreview(h.chunk.text),
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

		const reranked = rerank(matches, params.query);
		const deduped = dedupeMatchesByMessage(reranked).slice(0, limit);
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
