import { createHash } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
import { ContentEncoding, StorageType } from "@remit/domain-enums";
import { createFilesystemStorageService } from "./backends/filesystem.js";
import { createS3StorageService } from "./backends/s3.js";

export type StorageTypeValue = (typeof StorageType)[keyof typeof StorageType];
export type ContentEncodingValue =
	(typeof ContentEncoding)[keyof typeof ContentEncoding];

export interface StorageReference {
	uri: string;
	storageType: StorageTypeValue;
	storageLocation: string;
	storageKey: string;
	sizeBytes: number;
	checksumSha256: string;
	contentEncoding: ContentEncodingValue;
}

/** Parameters for storing a message body (raw RFC822 content) */
export interface StoreMessageBodyParams {
	accountId: string;
	messageId: string;
	content: Buffer;
}

/** Parameters for storing a body part (attachment, inline content) */
export interface StoreBodyPartParams {
	accountId: string;
	messageId: string;
	partPath: string;
	content: Buffer;
	contentType?: string;
}

/** Parameters for storing deduplicated content (attachments shared across messages) */
export interface StoreDeduplicatedParams {
	accountId: string;
	content: Buffer;
	contentType?: string;
}

export interface StorageService {
	/** Store a message body (raw RFC822 content) */
	storeMessageBody(params: StoreMessageBodyParams): Promise<StorageReference>;

	/** Store a body part (attachment, inline content) */
	storeBodyPart(params: StoreBodyPartParams): Promise<StorageReference>;

	/** Store deduplicated content (content-addressable, for attachments) */
	storeDeduplicated(params: StoreDeduplicatedParams): Promise<StorageReference>;

	/** Retrieve content by URI */
	retrieve(uri: string): Promise<Buffer>;

	/** Check if content exists */
	exists(uri: string): Promise<boolean>;

	/** Delete content by URI */
	delete(uri: string): Promise<void>;
}

// Path builders - centralized path formatting per RFC 011
export const buildMessageBodyKey = (
	accountId: string,
	messageId: string,
): string => `accounts/${accountId}/messages/${messageId}/body.eml`;

export const buildBodyPartKey = (
	accountId: string,
	messageId: string,
	partPath: string,
): string => `accounts/${accountId}/messages/${messageId}/parts/${partPath}`;

export const buildDeduplicatedKey = (
	accountId: string,
	checksumSha256: string,
): string =>
	`accounts/${accountId}/dedup/${checksumSha256.slice(0, 2)}/${checksumSha256}`;

export const computeChecksum = (content: Buffer): string =>
	createHash("sha256").update(content).digest("hex");

export const createStorageService = (): StorageService => {
	const bucketName = process.env.S3_BUCKET_NAME;

	if (bucketName) {
		const client = new S3Client({
			endpoint: process.env.S3_ENDPOINT,
		});
		return createS3StorageService(client, bucketName);
	}

	const basePath = process.env.STORAGE_LOCAL_PATH ?? ".remit/storage";
	return createFilesystemStorageService(basePath);
};

export const createMockStorageService = (): StorageService => {
	const storage = new Map<string, Buffer>();

	const storeInternal = (key: string, content: Buffer): StorageReference => {
		const checksumSha256 = computeChecksum(content);
		const uri = `mock://${key}`;
		storage.set(uri, content);
		return {
			uri,
			storageType: StorageType.Filesystem,
			storageLocation: "mock",
			storageKey: key,
			sizeBytes: content.length,
			checksumSha256,
			contentEncoding: ContentEncoding.None,
		};
	};

	const storeMessageBody: StorageService["storeMessageBody"] = async (
		params,
	) => {
		const { accountId, messageId, content } = params;
		return storeInternal(buildMessageBodyKey(accountId, messageId), content);
	};

	const storeBodyPart: StorageService["storeBodyPart"] = async (params) => {
		const { accountId, messageId, partPath, content } = params;
		return storeInternal(
			buildBodyPartKey(accountId, messageId, partPath),
			content,
		);
	};

	const storeDeduplicated: StorageService["storeDeduplicated"] = async (
		params,
	) => {
		const { accountId, content } = params;
		const checksumSha256 = computeChecksum(content);
		return storeInternal(
			buildDeduplicatedKey(accountId, checksumSha256),
			content,
		);
	};

	return {
		storeMessageBody,
		storeBodyPart,
		storeDeduplicated,
		retrieve: async (uri) => {
			const content = storage.get(uri);
			if (!content) throw new Error(`Not found: ${uri}`);
			return content;
		},
		exists: async (uri) => storage.has(uri),
		delete: async (uri) => {
			storage.delete(uri);
		},
	};
};
