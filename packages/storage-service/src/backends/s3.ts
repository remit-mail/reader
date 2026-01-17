import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	type S3Client,
} from "@aws-sdk/client-s3";
import { ContentEncoding, StorageType } from "@remit/domain-enums";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { StorageReference, StorageService, StoreOptions } from "../storage.js";
import { parseStorageUri } from "../uri.js";

export const createS3StorageService = (
	client: S3Client,
	bucketName: string,
): StorageService => {
	const store = async (
		content: Buffer,
		options: StoreOptions,
	): Promise<StorageReference> => {
		const { key, contentEncoding = ContentEncoding.None, contentType } = options;

		const checksumSha256 = createHash("sha256").update(content).digest("hex");
		const finalKey = options.contentAddressable
			? `dedup/${checksumSha256.slice(0, 2)}/${checksumSha256}`
			: key;

		const body =
			contentEncoding === ContentEncoding.Gzip ? gzipSync(content) : content;

		await client.send(
			new PutObjectCommand({
				Bucket: bucketName,
				Key: finalKey,
				Body: body,
				ContentType: contentType,
				ContentEncoding:
					contentEncoding !== ContentEncoding.None ? contentEncoding : undefined,
				ChecksumSHA256: Buffer.from(checksumSha256, "hex").toString("base64"),
			}),
		);

		return {
			uri: `s3://${bucketName}/${finalKey}`,
			storageType: StorageType.S3,
			storageLocation: bucketName,
			storageKey: finalKey,
			sizeBytes: body.length,
			checksumSha256,
			contentEncoding,
		};
	};

	const retrieve = async (uri: string): Promise<Buffer> => {
		const { storageKey } = parseStorageUri(uri);

		const response = await client.send(
			new GetObjectCommand({
				Bucket: bucketName,
				Key: storageKey,
			}),
		);

		if (!response.Body) {
			throw new Error(`Empty response body for: ${uri}`);
		}

		const body = await response.Body.transformToByteArray();
		const buffer = Buffer.from(body);

		if (response.ContentEncoding === "gzip") {
			return gunzipSync(buffer);
		}

		return buffer;
	};

	const exists = async (uri: string): Promise<boolean> => {
		const { storageKey } = parseStorageUri(uri);

		return client
			.send(
				new HeadObjectCommand({
					Bucket: bucketName,
					Key: storageKey,
				}),
			)
			.then(() => true)
			.catch(() => false);
	};

	const del = async (uri: string): Promise<void> => {
		const { storageKey } = parseStorageUri(uri);

		await client.send(
			new DeleteObjectCommand({
				Bucket: bucketName,
				Key: storageKey,
			}),
		);
	};

	const contentAddressableKey = (content: Buffer, prefix = "dedup"): string => {
		const hash = createHash("sha256").update(content).digest("hex");
		return `${prefix}/${hash.slice(0, 2)}/${hash}`;
	};

	return { store, retrieve, exists, delete: del, contentAddressableKey };
};
