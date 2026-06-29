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

// S3 Vectors rejects any metadata value that is not a string, number,
// boolean, or array of those. Address-shaped objects (sender/recipients) and
// any other nested object must be flattened to a scalar before upsert or the
// PutVectors call dead-letters with a ValidationException.
type AddressLike = {
	name?: string | null;
	email?: string;
	address?: string;
	mailbox?: string;
	host?: string;
};

const isAddressLike = (value: Record<string, unknown>): value is AddressLike =>
	typeof value.email === "string" ||
	typeof value.address === "string" ||
	(typeof value.mailbox === "string" && typeof value.host === "string");

const formatAddress = (addr: AddressLike): string => {
	const email =
		addr.email ??
		addr.address ??
		(addr.mailbox && addr.host ? `${addr.mailbox}@${addr.host}` : "");
	const name = typeof addr.name === "string" ? addr.name.trim() : "";
	if (name.length > 0) return `${name} <${email}>`;
	return email;
};

const isScalar = (value: unknown): value is string | number | boolean =>
	typeof value === "string" ||
	typeof value === "number" ||
	typeof value === "boolean";

// Flatten a single metadata value to an S3-Vectors-safe scalar (or array of
// scalars). Objects become display strings; arrays of objects become arrays of
// strings. The result is guaranteed to satisfy the S3 Vectors constraint.
const flattenMetadataValue = (value: unknown): DocumentType => {
	if (value === null || value === undefined) return null;
	if (isScalar(value)) return value;
	if (Array.isArray(value)) {
		return value.map((item) => {
			if (item === null || item === undefined) return "";
			if (isScalar(item)) return item;
			if (typeof item === "object" && isAddressLike(item as AddressLike)) {
				return formatAddress(item as AddressLike);
			}
			return JSON.stringify(item);
		});
	}
	if (typeof value === "object") {
		const obj = value as Record<string, unknown>;
		if (isAddressLike(obj)) return formatAddress(obj);
		return JSON.stringify(obj);
	}
	throw new Error(
		`Cannot convert metadata value of type ${typeof value} to a scalar`,
	);
};

const toMetadataDocument = (metadata: ChunkMetadata): DocumentType => {
	const out: { [k: string]: DocumentType } = {};
	for (const [k, v] of Object.entries(metadata)) {
		if (v === undefined) continue;
		const flattened = flattenMetadataValue(v);
		// S3 Vectors rejects null metadata values. Omit the key entirely (e.g.
		// fromName for a sender with no display name) rather than emit null.
		if (flattened === null) continue;
		out[k] = flattened;
	}
	return out;
};

const PUT_BATCH_SIZE = 100;
const DELETE_BATCH_SIZE = 100;
// AWS S3 Vectors ListVectors caps maxResults at 500 per page.
const LIST_PAGE_SIZE = 500;
// Safety bound: stop pagination after this many pages to prevent runaway
// loops on a malformed response (e.g. S3 always returning nextToken).
// 10,000 pages * 500 = 5,000,000 vectors per messageId — well above any
// realistic chunk count. The loop errors loudly if this is hit; it never
// silently truncates a delete.
const MAX_LIST_PAGES = 10_000;

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

// S3 Vectors does NOT accept implicit AND across multiple metadata keys — a flat
// multi-key object (e.g. { accountConfigId, mailboxIds }) is rejected with
// `ValidationException: Invalid filter`. Multiple conditions must be combined
// explicitly with $and, each as its own single-key object. A single condition is
// accepted bare, so we don't needlessly wrap it.
const buildFilterExpression = (
	filter: VectorQueryFilter | undefined,
): DocumentType | undefined => {
	if (!filter) return undefined;
	const conditions: { [k: string]: DocumentType }[] = [];
	if (filter.accountConfigId !== undefined) {
		conditions.push({ accountConfigId: filter.accountConfigId });
	}
	if (filter.mailboxId !== undefined) {
		conditions.push({
			mailboxIds: { $in: [filter.mailboxId] as DocumentType[] },
		});
	}
	if (filter.chunkType !== undefined) {
		conditions.push({ chunkType: filter.chunkType });
	}
	if (filter.hasAttachment !== undefined) {
		conditions.push({ hasAttachment: filter.hasAttachment });
	}
	if (filter.hasStars !== undefined) {
		conditions.push({ hasStars: filter.hasStars });
	}
	if (filter.isRead !== undefined) {
		conditions.push({ isRead: filter.isRead });
	}
	if (filter.sentDateRange) {
		const range: { [k: string]: DocumentType } = {};
		if (filter.sentDateRange.from !== undefined) {
			range.$gte = filter.sentDateRange.from;
		}
		if (filter.sentDateRange.to !== undefined) {
			range.$lte = filter.sentDateRange.to;
		}
		if (Object.keys(range).length > 0) conditions.push({ sentDate: range });
	}
	if (conditions.length === 0) return undefined;
	if (conditions.length === 1) return conditions[0];
	return { $and: conditions as DocumentType[] };
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
					metadata: toMetadataDocument(v.metadata),
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
		let page = 0;
		while (true) {
			if (page >= MAX_LIST_PAGES) {
				throw new Error(
					`findChunkKeysForMessage: exceeded MAX_LIST_PAGES (${MAX_LIST_PAGES}) for messageId=${messageId}`,
				);
			}
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
			page++;
		}
	};
}

export const createS3VectorsBackend = (
	config: S3VectorsBackendConfig,
): S3VectorsBackend => new S3VectorsBackend(config);
