import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ThreadMessageService } from "@remit/remit-electrodb-service";
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
	threadMessageService: ThreadMessageService;
	storageService: StorageService;
	searchService: SearchService;
}

let cached: Services | undefined;

export const getServices = (): Services => {
	if (cached) return cached;

	const tableName = process.env.DYNAMODB_TABLE_NAME;
	if (!tableName) throw new Error("DYNAMODB_TABLE_NAME is required");

	const vectorBucketArn = process.env.S3_VECTORS_BUCKET_ARN;
	if (!vectorBucketArn) throw new Error("S3_VECTORS_BUCKET_ARN is required");

	const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
	const threadMessageService = new ThreadMessageService({
		client: ddbClient,
		table: tableName,
	});

	const storageService = createStorageService();

	const vectorBucketName = vectorBucketArn.split("/")[0].split(":").pop();
	if (!vectorBucketName)
		throw new Error("Cannot parse bucket name from S3_VECTORS_BUCKET_ARN");
	const indexName = vectorBucketArn.includes("/")
		? vectorBucketArn.split("/").slice(1).join("/")
		: "messages";

	const embedder = new BedrockEmbeddingService();
	const store = createS3VectorsBackend({
		vectorBucketName,
		indexName,
	});
	const searchService = createSearchService({ embedder, store });

	cached = { threadMessageService, storageService, searchService };
	return cached;
};

export const createServices = (overrides: Services): Services => overrides;
