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
import { createHeartbeat } from "@remit/sqs-client/heartbeat";
import type { StorageService } from "@remit/storage-service";
import { createStorageService } from "@remit/storage-service/s3";
import {
	type AdaptiveEmbeddingConfig,
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

const MB = 1024 * 1024;

/**
 * The stall's heartbeat writes the poll loop's own file, not a second one. A
 * file of its own would be fresh only while stalling and stale the rest of the
 * time, and the healthcheck reads the oldest file it finds — an idle worker
 * would report unhealthy. Undefined off the standalone deployment, where
 * `createHeartbeat` writes nothing anyway.
 */
const searchIndexQueueName = (): string | undefined => {
	const url = process.env.SQS_QUEUE_URL_SEARCH_INDEX;
	if (!url) return undefined;
	return new URL(url).pathname.split("/").pop();
};

let governor: MemoryGovernor | undefined;
let governorConfig: AdaptiveEmbeddingConfig | undefined;
let governorResolved = false;

/**
 * Built at startup rather than on the first message, so a threshold the
 * operator typed wrong fails the container instead of one email, and so the
 * gauges render from the first scrape instead of from whenever mail arrives.
 *
 * Only the in-process embedder gets one: its memory is native and unbounded —
 * the model, its arenas and its tensors are onnxruntime allocations that no V8
 * heap ceiling covers (#585). Bedrock and the deterministic test embedder hold
 * nothing on this box and are left alone.
 */
export const getMemoryGovernor = (): MemoryGovernor | undefined => {
	if (governorResolved) return governor;
	governorResolved = true;
	if (process.env.SEARCH_EMBEDDING_PROVIDER !== "local") return undefined;

	const config = readAdaptiveEmbeddingConfigFromEnv();
	const metrics = registerAdaptiveEmbedding({
		batchSize: config.minBatchSize,
		concurrency: 1,
	});
	const log = createLogger();
	log.info("Search index embedding governed by memory", {
		batchSize: config.minBatchSize,
		maxBatchSize: config.maxBatchSize,
		maxConcurrency: config.maxConcurrency,
		headroomMb: Math.round(config.headroomBytes / MB),
		criticalMb: Math.round(config.criticalBytes / MB),
		rssCeilingMb: Math.round(config.rssCeilingBytes / MB),
		stallMaxMs: config.stallMaxMs,
	});
	const queueName = searchIndexQueueName();
	governorConfig = config;
	governor = new MemoryGovernor(config, {
		readMemory: readSystemMemory,
		sleep: (ms) => delay(ms),
		now: () => Date.now(),
		log,
		beat: queueName ? createHeartbeat(queueName) : undefined,
		onPlan: metrics.recordPlan,
		onStall: metrics.recordStall,
	});
	return governor;
};

const governed = (embedder: EmbeddingService): EmbeddingService => {
	const memoryGovernor = getMemoryGovernor();
	if (!memoryGovernor) return embedder;
	return createAdaptiveEmbeddingService(
		embedder,
		memoryGovernor,
		governorConfig?.stallMaxMs,
	);
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
