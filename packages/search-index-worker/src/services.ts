import { setTimeout as delay } from "node:timers/promises";
import { createLogger } from "@remit/logger-lambda";
import {
	createSearchService,
	type EmbeddingService,
	type SearchService,
} from "@remit/search-service";
import {
	buildEmbeddingServiceFromEnv,
	buildVectorStoreFromEnv,
} from "@remit/search-service/from-env";
import type { StorageService } from "@remit/storage-service";
import { createStorageService } from "@remit/storage-service/s3";
import {
	createAdaptiveEmbeddingService,
	MemoryGovernor,
	readAdaptiveEmbeddingConfigFromEnv,
} from "./adaptive-embedder.js";
import {
	buildDataPortsFromEnv,
	type SearchIndexDataPorts,
} from "./data-ports.js";
import type { IndexOutcome } from "./handler.js";
import { readSystemMemory } from "./memory.js";
import { registerAdaptiveEmbedding } from "./metrics.js";

export interface Services {
	accountService: SearchIndexDataPorts["account"];
	threadMessageService: SearchIndexDataPorts["threadMessage"];
	storageService: StorageService;
	searchService: SearchService;
	resolveAccountId?: SearchIndexDataPorts["resolveAccountId"];
	/**
	 * Fired once per upsert outcome — the relational work-summary signal
	 * (`consumer.ts` wires this to `IndexWorkStats`). `undefined` on the Lambda
	 * path, where it never fires and so never affects behavior.
	 */
	onIndexOutcome?: (outcome: IndexOutcome) => void;
}

let cached: Services | undefined;

/**
 * The in-process embedder is the one whose memory is native and unbounded — the
 * model, its arenas and its tensors are onnxruntime allocations that no V8 heap
 * ceiling covers (#585), so it runs under the governor. Bedrock and the
 * deterministic test embedder hold nothing on this box and are left alone.
 */
const governed = (embedder: EmbeddingService): EmbeddingService => {
	if (process.env.SEARCH_EMBEDDING_PROVIDER !== "local") return embedder;
	const config = readAdaptiveEmbeddingConfigFromEnv();
	const metrics = registerAdaptiveEmbedding({
		batchSize: config.minBatchSize,
		concurrency: 1,
	});
	const log = createLogger();
	log.info("Search index embedding governed by available memory", {
		batchSize: config.minBatchSize,
		maxBatchSize: config.maxBatchSize,
		maxConcurrency: config.maxConcurrency,
		headroomMb: Math.round(config.headroomBytes / (1024 * 1024)),
		criticalMb: Math.round(config.criticalBytes / (1024 * 1024)),
	});
	const governor = new MemoryGovernor(config, {
		readMemory: readSystemMemory,
		sleep: (ms) => delay(ms),
		log,
		onPlan: metrics.recordPlan,
		onStall: metrics.recordStall,
	});
	return createAdaptiveEmbeddingService(embedder, governor);
};

export const getServices = async (): Promise<Services> => {
	if (cached) return cached;

	const dataPorts = await buildDataPortsFromEnv();

	const storageService = createStorageService();

	// The worker must have a durable vector store — a typo'd or missing env var
	// must not silently succeed by falling back to the throwaway in-memory store
	// (which emits success metrics but drops every vector).
	const localPath = process.env.LOCAL_VECTORDB_PATH;
	const bucket = process.env.S3_VECTORS_BUCKET_NAME;
	const indexName = process.env.S3_VECTORS_INDEX_NAME;
	if (!localPath && !(bucket && indexName)) {
		throw new Error(
			"Vector store is not configured: set LOCAL_VECTORDB_PATH for local dev, " +
				"or both S3_VECTORS_BUCKET_NAME and S3_VECTORS_INDEX_NAME for " +
				"production.",
		);
	}

	// Build the embedder first so we can pass its dimension count to the
	// sqlite-vec store — the vec0 table dimension must match the embedder.
	const embedder = governed(buildEmbeddingServiceFromEnv());
	const searchService = createSearchService({
		store: buildVectorStoreFromEnv(embedder.dimensions),
		embedder,
	});

	cached = {
		accountService: dataPorts.account,
		threadMessageService: dataPorts.threadMessage,
		resolveAccountId: dataPorts.resolveAccountId,
		storageService,
		searchService,
	};
	return cached;
};
