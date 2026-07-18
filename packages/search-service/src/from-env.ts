import type { DataType } from "@huggingface/transformers";
import type { VectorStoreService } from "./backends/memory.js";
import { createMemoryVectorStore } from "./backends/memory.js";
import { createPgVectorStore } from "./backends/pgvector.js";
import { createS3VectorsBackend } from "./backends/s3-vectors.js";
import { createSqliteVectorStore } from "./backends/sqlite-vec.js";
import {
	BedrockEmbeddingService,
	createDeterministicEmbeddingService,
	createLocalEmbeddingService,
	type EmbeddingService,
} from "./embeddings.js";

const parseDimensions = (): number | undefined => {
	const raw = process.env.SEARCH_EMBEDDING_DIMENSIONS;
	if (!raw) return undefined;
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(
			`SEARCH_EMBEDDING_DIMENSIONS must be a positive integer, got: ${raw}`,
		);
	}
	return parsed;
};

const DTYPES: readonly DataType[] = [
	"auto",
	"fp32",
	"fp16",
	"q8",
	"int8",
	"uint8",
	"q4",
	"bnb4",
	"q4f16",
	"q2",
	"q2f16",
	"q1",
	"q1f16",
];

const parseDtype = (): DataType | undefined => {
	const raw = process.env.SEARCH_EMBEDDING_DTYPE;
	if (!raw) return undefined;
	if (!DTYPES.includes(raw as DataType)) {
		throw new Error(
			`SEARCH_EMBEDDING_DTYPE must be one of ${DTYPES.join(", ")}, got: ${raw}`,
		);
	}
	return raw as DataType;
};

/**
 * Select a vector store from the environment, shared by every process that
 * composes a SearchService (the API, the search-index worker, the local
 * indexing shim) so the selection rule lives in one place:
 *
 * - `DATA_BACKEND=postgres` + `PG_CONNECTION_URL` set → pgvector (Postgres parity).
 * - `LOCAL_VECTORDB_PATH` set → persistent sqlite-vec (local dev).
 * - `S3_VECTORS_BUCKET_NAME` + `S3_VECTORS_INDEX_NAME` set → S3 Vectors (prod).
 * - otherwise → in-memory store (unit tests / default).
 *
 * `dimensions` should be the embedding service's dimension count. When a
 * dimension-typed store is selected (sqlite-vec's vec0 table, pgvector's
 * `VECTOR(n)` column), it is created with that dimension so the store and
 * embedder always agree instead of failing confusingly at insert time (e.g. a
 * 64-dim deterministic embedder writing into a 384-wide column).
 */
export const buildVectorStoreFromEnv = (
	dimensions?: number,
): VectorStoreService => {
	const pgConnectionUrl = process.env.PG_CONNECTION_URL;
	if (process.env.DATA_BACKEND === "postgres" && pgConnectionUrl) {
		return createPgVectorStore({
			connectionString: pgConnectionUrl,
			dimensions,
		});
	}
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
 * - `SEARCH_EMBEDDING_PROVIDER=local` → Transformers.js model (local dev). The
 *   model is `SEARCH_EMBEDDING_MODEL_ID` (default MiniLM); the Postgres-parity
 *   stack points it at a multilingual MiniLM so the ~50% non-English mail corpus
 *   embeds well. Both models are 384-dim, so the pgvector column is stable.
 * - `SEARCH_EMBEDDING_PROVIDER=bedrock` → Bedrock Titan (prod).
 * - otherwise → deterministic bag-of-words embedder (unit tests / default).
 *
 * `SEARCH_EMBEDDING_DIMENSIONS`, when set, pins the dimension count for the local
 * and deterministic embedders so the store's vector column and the embedder
 * agree regardless of which embedder a given process runs.
 *
 * `SEARCH_EMBEDDING_DTYPE`, when set, selects the ONNX weight precision the local
 * model loads (`q8` → int8-quantized `model_quantized.onnx`); unset defaults to
 * `fp32`. The search-index-worker container sets `q8` and bakes the matching file.
 */
export const buildEmbeddingServiceFromEnv = (): EmbeddingService => {
	const provider = process.env.SEARCH_EMBEDDING_PROVIDER;
	const dimensions = parseDimensions();
	if (provider === "local") {
		return createLocalEmbeddingService({
			modelId: process.env.SEARCH_EMBEDDING_MODEL_ID,
			dimensions,
			dtype: parseDtype(),
		});
	}
	if (provider === "bedrock") {
		return new BedrockEmbeddingService({
			region: process.env.AWS_REGION,
			modelId: process.env.SEARCH_EMBEDDING_MODEL_ID,
		});
	}
	return createDeterministicEmbeddingService({ dimensions });
};
