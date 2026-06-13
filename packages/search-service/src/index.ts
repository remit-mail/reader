export {
	createMemoryVectorStore,
	MemoryVectorStore,
	type VectorStoreService,
} from "./backends/memory.js";
export {
	createS3VectorsBackend,
	S3VectorsBackend,
	type S3VectorsBackendConfig,
} from "./backends/s3-vectors.js";
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
export {
	type BedrockEmbeddingConfig,
	BedrockEmbeddingService,
	createDeterministicEmbeddingService,
	type DeterministicEmbeddingConfig,
	DeterministicEmbeddingService,
	type EmbeddingService,
} from "./embeddings.js";
export {
	createSearchService,
	DefaultSearchService,
	type SearchService,
	type SearchServiceConfig,
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
