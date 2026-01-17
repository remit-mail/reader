import { S3Client } from "@aws-sdk/client-s3";
import { ContentEncoding, StorageType } from "@remit/domain-enums";
import { createHash } from "node:crypto";
import { createFilesystemStorageService } from "./backends/filesystem.js";
import { createS3StorageService } from "./backends/s3.js";

export type StorageTypeValue = (typeof StorageType)[keyof typeof StorageType];
export type ContentEncodingValue = (typeof ContentEncoding)[keyof typeof ContentEncoding];

export interface StorageReference {
	uri: string;
	storageType: StorageTypeValue;
	storageLocation: string;
	storageKey: string;
	sizeBytes: number;
	checksumSha256: string;
	contentEncoding: ContentEncodingValue;
}

export interface StoreOptions {
	key: string;
	contentEncoding?: ContentEncodingValue;
	contentType?: string;
	contentAddressable?: boolean;
}

export interface StorageService {
	store(content: Buffer, options: StoreOptions): Promise<StorageReference>;
	retrieve(uri: string): Promise<Buffer>;
	exists(uri: string): Promise<boolean>;
	delete(uri: string): Promise<void>;
	contentAddressableKey(content: Buffer, prefix?: string): string;
}

export const createStorageService = (): StorageService => {
	const bucketName = process.env.S3_BUCKET_NAME;

	if (bucketName) {
		const client = new S3Client({
			endpoint: process.env.S3_ENDPOINT,
		});
		return createS3StorageService(client, bucketName);
	}

	const basePath = process.env.STORAGE_LOCAL_PATH ?? "/tmp/remit";
	return createFilesystemStorageService(basePath);
};

export const createMockStorageService = (): StorageService => {
	const storage = new Map<string, Buffer>();

	return {
		store: async (content, options) => {
			const checksumSha256 = createHash("sha256").update(content).digest("hex");
			const finalKey = options.contentAddressable
				? `dedup/${checksumSha256.slice(0, 2)}/${checksumSha256}`
				: options.key;
			const uri = `mock://${finalKey}`;
			storage.set(uri, content);
			return {
				uri,
				storageType: StorageType.Filesystem,
				storageLocation: "mock",
				storageKey: finalKey,
				sizeBytes: content.length,
				checksumSha256,
				contentEncoding: options.contentEncoding ?? ContentEncoding.None,
			};
		},
		retrieve: async (uri) => {
			const content = storage.get(uri);
			if (!content) throw new Error(`Not found: ${uri}`);
			return content;
		},
		exists: async (uri) => storage.has(uri),
		delete: async (uri) => {
			storage.delete(uri);
		},
		contentAddressableKey: (content, prefix = "dedup") => {
			const hash = createHash("sha256").update(content).digest("hex");
			return `${prefix}/${hash.slice(0, 2)}/${hash}`;
		},
	};
};
