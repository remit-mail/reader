import type { VectorStoreService } from "./backends/memory.js";
import { createMemoryVectorStore } from "./backends/memory.js";
import { createS3VectorsBackend } from "./backends/s3-vectors.js";
import { createSqliteVectorStore } from "./backends/sqlite-vec.js";
import {
	BedrockEmbeddingService,
	createDeterministicEmbeddingService,
	createLocalEmbeddingService,
	type EmbeddingService,
} from "./embeddings.js";

/**
 * Select a vector store from the environment, shared by every process that
 * composes a SearchService (the API, the search-index worker, the local
 * indexing shim) so the selection rule lives in one place:
 *
 * - `LOCAL_VECTORDB_PATH` set → persistent sqlite-vec (local dev).
 * - `S3_VECTORS_BUCKET_NAME` + `S3_VECTORS_INDEX_NAME` set → S3 Vectors (prod).
 * - otherwise → in-memory store (unit tests / default).
 *
 * `dimensions` should be the embedding service's dimension count. When the
 * sqlite-vec store is selected, the vec0 table is created with that dimension,
 * so the store and embedder always agree instead of failing confusingly at
 * insert time (e.g. a 64-dim deterministic embedder writing into a FLOAT[384]
 * table).
 */
export const buildVectorStoreFromEnv = (
	dimensions?: number,
): VectorStoreService => {
	const localPath = process.env.LOCAL_VECTORDB_PATH;
	if (localPath) {
		return createSqliteVectorStore({ path: localPath, dimensions });
	}
	const bucket = process.env.S3_VECTORS_BUCKET_NAME;
	const indexName = process.env.S3_VECTORS_INDEX_NAME;
	if (bucket && indexName) {
		return createS3VectorsBackend({
			vectorBucketName: bucket,
			indexName,
			region: process.env.AWS_REGION,
		});
	}
	return createMemoryVectorStore();
};

/**
 * Select an embedder from the environment, mirroring `buildVectorStoreFromEnv`:
 *
 * - `SEARCH_EMBEDDING_PROVIDER=local` → Transformers.js MiniLM (local dev).
 * - `SEARCH_EMBEDDING_PROVIDER=bedrock` → Bedrock Titan (prod).
 * - otherwise → deterministic bag-of-words embedder (unit tests / default).
 */
export const buildEmbeddingServiceFromEnv = (): EmbeddingService => {
	const provider = process.env.SEARCH_EMBEDDING_PROVIDER;
	if (provider === "local") {
		return createLocalEmbeddingService();
	}
	if (provider === "bedrock") {
		return new BedrockEmbeddingService({
			region: process.env.AWS_REGION,
			modelId: process.env.SEARCH_EMBEDDING_MODEL_ID,
		});
	}
	return createDeterministicEmbeddingService();
};
