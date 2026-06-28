import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
	AccountService,
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import {
	BedrockEmbeddingService,
	createS3VectorsBackend,
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
	messageService: MessageService;
	storageService: StorageService;
	searchService: SearchService;
}

let cached: Services | undefined;

export const getServices = (): Services => {
	if (cached) return cached;

	const tableName = process.env.DYNAMODB_TABLE_NAME;
	if (!tableName) throw new Error("DYNAMODB_TABLE_NAME is required");

	const vectorBucketName = process.env.S3_VECTORS_BUCKET_NAME;
	if (!vectorBucketName) throw new Error("S3_VECTORS_BUCKET_NAME is required");

	const indexName = process.env.S3_VECTORS_INDEX_NAME;
	if (!indexName) throw new Error("S3_VECTORS_INDEX_NAME is required");

	const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
	const accountService = new AccountService({
		client: ddbClient,
		table: tableName,
	});
	const threadMessageService = new ThreadMessageService({
		client: ddbClient,
		table: tableName,
	});
	const messageService = new MessageService({
		client: ddbClient,
		table: tableName,
	});

	const storageService = createStorageService();

	const embedder = new BedrockEmbeddingService();
	const store = createS3VectorsBackend({
		vectorBucketName,
		indexName,
	});
	const searchService = createSearchService({ embedder, store });

	cached = {
		accountService,
		threadMessageService,
		messageService,
		storageService,
		searchService,
	};
	return cached;
};

export const createServices = (overrides: Services): Services => overrides;
