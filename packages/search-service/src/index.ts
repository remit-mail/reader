export {
	type AnchorBuildDeps,
	type AnchorBuildParams,
	type AnchorPayload,
	buildAnchorSourceText,
	buildMessageAnchor,
	poolChunkVectors,
} from "./anchor.js";
export {
	createMemoryVectorStore,
	MemoryVectorStore,
	type VectorStoreService,
} from "./backends/memory.js";
export {
	type ChunkInput,
	createEmailChunker,
	type EmailChunker,
} from "./chunking/chunker.js";
export {
	buildEntityChunks,
	type ExtractedEntities,
	extractEntities,
} from "./chunking/entities.js";
export {
	buildBodyChunks,
	shannonEntropy,
	stripBoilerplate,
} from "./chunking/entropy.js";
export {
	buildStructuredChunks,
	extractAttachmentFileTypes,
} from "./chunking/structured.js";
export { computeContentHash } from "./content-hash.js";
export {
	createDeterministicEmbeddingService,
	createLocalEmbeddingService,
	type DeterministicEmbeddingConfig,
	DeterministicEmbeddingService,
	type EmbeddingService,
	type LocalEmbeddingConfig,
	LocalEmbeddingService,
} from "./embeddings.js";
export {
	createSearchService,
	DefaultSearchService,
	literalMatchScore,
	rerank,
	type SearchService,
	type SearchServiceConfig,
	tokenizeQuery,
	type UpsertOptions,
	type UpsertResult,
} from "./search.js";
export type {
	AttachmentChunkInput,
	Chunk,
	ChunkMetadata,
	ChunkType,
	EnvelopeChunkAddress,
	EnvelopeChunkInput,
	IndexEmailParams,
	ParsedBodyForChunking,
	SearchIndexMessage,
	SearchParams,
	SearchResult,
	VectorMatch,
	VectorQuery,
	VectorQueryFilter,
	VectorRecord,
} from "./types.js";
export { searchIndexMessageSchema } from "./types.js";
