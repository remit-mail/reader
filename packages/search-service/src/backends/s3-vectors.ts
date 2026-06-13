import {
	DeleteVectorsCommand,
	ListVectorsCommand,
	PutVectorsCommand,
	QueryVectorsCommand,
	S3VectorsClient,
} from "@aws-sdk/client-s3vectors";
import type { DocumentType } from "@smithy/types";
import type {
	ChunkMetadata,
	VectorMatch,
	VectorQuery,
	VectorQueryFilter,
	VectorRecord,
} from "../types.js";
import type { VectorStoreService } from "./memory.js";

const toDocument = (value: unknown): DocumentType => {
	if (value === null) return null;
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value;
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map(toDocument);
	if (typeof value === "object") {
		const out: { [k: string]: DocumentType } = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			out[k] = toDocument(v);
		}
		return out;
	}
	throw new Error(
		`Cannot convert value of type ${typeof value} to DocumentType`,
	);
};

const PUT_BATCH_SIZE = 100;
const DELETE_BATCH_SIZE = 100;
// AWS S3 Vectors ListVectors caps maxResults at 500 per page.
const LIST_PAGE_SIZE = 500;
// Safety bound: stop pagination after this many pages to prevent runaway
// loops on a malformed response. 50 pages * 500 = 25,000 vectors per
// messageId — far above any realistic chunk count for a single message.
const MAX_LIST_PAGES = 50;

export interface S3VectorsBackendConfig {
	client?: S3VectorsClient;
	region?: string;
	vectorBucketName: string;
	indexName: string;
}

const isStringArray = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((v) => typeof v === "string");

const toMetadata = (raw: unknown): ChunkMetadata => {
	if (typeof raw !== "object" || raw === null) {
		throw new Error("S3 Vectors metadata is not an object");
	}
	const obj = raw as Record<string, unknown>;
	if (
		typeof obj.messageId !== "string" ||
		typeof obj.threadId !== "string" ||
		typeof obj.accountConfigId !== "string" ||
		typeof obj.chunkType !== "string" ||
		typeof obj.sentDate !== "number" ||
		typeof obj.isRead !== "boolean" ||
		typeof obj.hasAttachment !== "boolean" ||
		typeof obj.hasStars !== "boolean" ||
		!isStringArray(obj.mailboxIds)
	) {
		throw new Error(`S3 Vectors metadata is malformed: ${JSON.stringify(obj)}`);
	}
	const fileTypes =
		obj.fileTypes !== undefined && isStringArray(obj.fileTypes)
			? obj.fileTypes
			: undefined;
	// fromName and subject are optional display fields added after initial
	// deployment. Pre-enrichment vectors will not have them; treat as absent.
	const fromName =
		obj.fromName === null
			? null
			: typeof obj.fromName === "string"
				? obj.fromName
				: undefined;
	const subject = typeof obj.subject === "string" ? obj.subject : undefined;
	return {
		messageId: obj.messageId,
		threadId: obj.threadId,
		accountConfigId: obj.accountConfigId,
		mailboxIds: obj.mailboxIds,
		chunkType: obj.chunkType as ChunkMetadata["chunkType"],
		sentDate: obj.sentDate,
		isRead: obj.isRead,
		hasAttachment: obj.hasAttachment,
		hasStars: obj.hasStars,
		fileTypes,
		...(fromName !== undefined ? { fromName } : {}),
		...(subject !== undefined ? { subject } : {}),
	};
};

const buildFilterExpression = (
	filter: VectorQueryFilter | undefined,
): DocumentType | undefined => {
	if (!filter) return undefined;
	const conditions: { [k: string]: DocumentType } = {};
	if (filter.accountConfigId !== undefined) {
		conditions.accountConfigId = filter.accountConfigId;
	}
	if (filter.mailboxId !== undefined) {
		conditions.mailboxIds = { $in: [filter.mailboxId] as DocumentType[] };
	}
	if (filter.chunkType !== undefined) {
		conditions.chunkType = filter.chunkType;
	}
	if (filter.hasAttachment !== undefined) {
		conditions.hasAttachment = filter.hasAttachment;
	}
	if (filter.hasStars !== undefined) {
		conditions.hasStars = filter.hasStars;
	}
	if (filter.isRead !== undefined) {
		conditions.isRead = filter.isRead;
	}
	if (filter.sentDateRange) {
		const range: { [k: string]: DocumentType } = {};
		if (filter.sentDateRange.from !== undefined) {
			range.$gte = filter.sentDateRange.from;
		}
		if (filter.sentDateRange.to !== undefined) {
			range.$lte = filter.sentDateRange.to;
		}
		if (Object.keys(range).length > 0) conditions.sentDate = range;
	}
	if (Object.keys(conditions).length === 0) return undefined;
	return conditions;
};

const chunkArray = <T>(arr: T[], size: number): T[][] => {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += size) {
		out.push(arr.slice(i, i + size));
	}
	return out;
};

export class S3VectorsBackend implements VectorStoreService {
	private client: S3VectorsClient;
	private vectorBucketName: string;
	private indexName: string;

	constructor(config: S3VectorsBackendConfig) {
		this.client =
			config.client ?? new S3VectorsClient({ region: config.region });
		this.vectorBucketName = config.vectorBucketName;
		this.indexName = config.indexName;
	}

	upsert = async (vectors: VectorRecord[]): Promise<void> => {
		for (const batch of chunkArray(vectors, PUT_BATCH_SIZE)) {
			const cmd = new PutVectorsCommand({
				vectorBucketName: this.vectorBucketName,
				indexName: this.indexName,
				vectors: batch.map((v) => ({
					key: v.chunkId,
					data: { float32: v.vector },
					metadata: toDocument(v.metadata),
				})),
			});
			await this.client.send(cmd);
		}
	};

	query = async (params: VectorQuery): Promise<VectorMatch[]> => {
		const cmd = new QueryVectorsCommand({
			vectorBucketName: this.vectorBucketName,
			indexName: this.indexName,
			topK: params.topK,
			queryVector: { float32: params.vector },
			filter: buildFilterExpression(params.filter),
			returnMetadata: true,
			returnDistance: true,
		});
		const response = await this.client.send(cmd);
		const out: VectorMatch[] = [];
		for (const v of response.vectors ?? []) {
			if (typeof v.key !== "string") continue;
			const distance = v.distance ?? 0;
			const score = 1 - distance;
			out.push({
				chunkId: v.key,
				score,
				metadata: toMetadata(v.metadata),
			});
		}
		return out;
	};

	delete = async (filter: { messageId: string }): Promise<void> => {
		const keys = await this.findChunkKeysForMessage(filter.messageId);
		if (keys.length === 0) return;
		for (const batch of chunkArray(keys, DELETE_BATCH_SIZE)) {
			const cmd = new DeleteVectorsCommand({
				vectorBucketName: this.vectorBucketName,
				indexName: this.indexName,
				keys: batch,
			});
			await this.client.send(cmd);
		}
	};

	private findChunkKeysForMessage = async (
		messageId: string,
	): Promise<string[]> => {
		// QueryVectors caps topK at 100 and returns no nextToken — it's a
		// similarity-search API, not a listing API. ListVectors is the right
		// surface here: it paginates natively and we don't need ranking.
		// ListVectors has no server-side metadata filter, so we filter
		// client-side on the key prefix. chunkIds are always
		// `${messageId}::${suffix}` (see chunker.ts), so we never need to
		// fetch metadata.
		const keyPrefix = `${messageId}::`;
		const keys: string[] = [];
		let nextToken: string | undefined;
		for (let page = 0; page < MAX_LIST_PAGES; page++) {
			const cmd = new ListVectorsCommand({
				vectorBucketName: this.vectorBucketName,
				indexName: this.indexName,
				maxResults: LIST_PAGE_SIZE,
				nextToken,
				returnData: false,
				returnMetadata: false,
			});
			const response = await this.client.send(cmd);
			for (const v of response.vectors ?? []) {
				if (typeof v.key === "string" && v.key.startsWith(keyPrefix)) {
					keys.push(v.key);
				}
			}
			nextToken = response.nextToken;
			if (!nextToken) return keys;
		}
		throw new Error(
			`findChunkKeysForMessage: exceeded MAX_LIST_PAGES (${MAX_LIST_PAGES}) for messageId=${messageId}`,
		);
	};
}

export const createS3VectorsBackend = (
	config: S3VectorsBackendConfig,
): S3VectorsBackend => new S3VectorsBackend(config);
