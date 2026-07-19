import { createSearchService, type SearchService } from "@remit/search-service";
import {
	buildEmbeddingServiceFromEnv,
	buildVectorStoreFromEnv,
} from "@remit/search-service/from-env";
import type { StorageService } from "@remit/storage-service";
import { createStorageService } from "@remit/storage-service/s3";
import {
	buildDataPortsFromEnv,
	type SearchIndexDataPorts,
} from "./data-ports.js";
import type { IndexOutcome } from "./handler.js";

export interface Services {
	accountService: SearchIndexDataPorts["account"];
	threadMessageService: SearchIndexDataPorts["threadMessage"];
	storageService: StorageService;
	searchService: SearchService;
	resolveAccountId?: SearchIndexDataPorts["resolveAccountId"];
	/**
	 * Fired once per upsert outcome — the pg-only work-summary signal
	 * (`consumer.ts` wires this to `IndexWorkStats`). `undefined` on the Lambda
	 * path, where it never fires and so never affects behavior.
	 */
	onIndexOutcome?: (outcome: IndexOutcome) => void;
}

let cached: Services | undefined;

export const getServices = async (): Promise<Services> => {
	if (cached) return cached;

	const dataPorts = await buildDataPortsFromEnv();

	const storageService = createStorageService();

	// The worker must have a durable vector store — a typo'd or missing S3 (or,
	// on Postgres, PG_CONNECTION_URL) env var must not silently succeed by
	// falling back to the throwaway in-memory store (which emits success
	// metrics but drops every vector).
	const isPostgres = process.env.DATA_BACKEND === "postgres";
	const pgConnectionUrl = process.env.PG_CONNECTION_URL;
	const localPath = process.env.LOCAL_VECTORDB_PATH;
	const bucket = process.env.S3_VECTORS_BUCKET_NAME;
	const indexName = process.env.S3_VECTORS_INDEX_NAME;
	if (
		!(isPostgres && pgConnectionUrl) &&
		!localPath &&
		!(bucket && indexName)
	) {
		throw new Error(
			"Vector store is not configured: set PG_CONNECTION_URL for the Postgres " +
				"backend, LOCAL_VECTORDB_PATH for local dev, or both " +
				"S3_VECTORS_BUCKET_NAME and S3_VECTORS_INDEX_NAME for production.",
		);
	}

	// Build the embedder first so we can pass its dimension count to the
	// sqlite-vec store — the vec0 table dimension must match the embedder.
	const embedder = buildEmbeddingServiceFromEnv();
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

export const createServices = (overrides: Services): Services => overrides;

/** Reset the singleton — test use only. */
export const _resetForTest = (): void => {
	cached = undefined;
};
