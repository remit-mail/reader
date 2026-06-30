import {
	AccountService,
	getClient,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import {
	buildEmbeddingServiceFromEnv,
	buildVectorStoreFromEnv,
	createSearchService,
	type SearchService,
} from "@remit/search-service";
import {
	createStorageService,
	type StorageService,
} from "@remit/storage-service";

export interface Services {
	accountService: AccountService;
	threadMessageService: ThreadMessageService;
	storageService: StorageService;
	searchService: SearchService;
}

let cached: Services | undefined;

export const getServices = (): Services => {
	if (cached) return cached;

	const tableName = process.env.DYNAMODB_TABLE_NAME;
	if (!tableName) throw new Error("DYNAMODB_TABLE_NAME is required");

	// getClient targets local DynamoDB in dev/test and default credentials in
	// prod, so the same worker logic drains the local search-index queue (via the
	// e2e-processor-shim) and the production SQS event-source mapping.
	const client = getClient();
	const accountService = new AccountService({ client, table: tableName });
	const threadMessageService = new ThreadMessageService({
		client,
		table: tableName,
	});

	const storageService = createStorageService();

	// The worker must have a durable vector store — a typo'd or missing S3
	// env var must not silently succeed by falling back to the throwaway
	// in-memory store (which emits success metrics but drops every vector).
	const localPath = process.env.LOCAL_VECTORDB_PATH;
	const bucket = process.env.S3_VECTORS_BUCKET_NAME;
	const indexName = process.env.S3_VECTORS_INDEX_NAME;
	if (!localPath && !(bucket && indexName)) {
		throw new Error(
			"Vector store is not configured: set LOCAL_VECTORDB_PATH for local dev " +
				"or both S3_VECTORS_BUCKET_NAME and S3_VECTORS_INDEX_NAME for production.",
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
		accountService,
		threadMessageService,
		storageService,
		searchService,
	};
	return cached;
};

export const createServices = (overrides: Services): Services => overrides;
