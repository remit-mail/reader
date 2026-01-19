import { gunzipSync, gzipSync } from "node:zlib";
import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	type S3Client,
} from "@aws-sdk/client-s3";
import { ContentEncoding, StorageType } from "@remit/domain-enums";
import type { StorageReference, StorageService } from "../storage.js";
import {
	buildBodyPartKey,
	buildDeduplicatedKey,
	buildMessageBodyKey,
	computeChecksum,
} from "../storage.js";
import { parseStorageUri } from "../uri.js";

interface StoreParams {
	key: string;
	content: Buffer;
	contentType?: string;
	compress?: boolean;
}

export const createS3StorageService = (
	client: S3Client,
	bucketName: string,
): StorageService => {
	const storeInternal = async (
		params: StoreParams,
	): Promise<StorageReference> => {
		const { key, content, contentType, compress = true } = params;
		const checksumSha256 = computeChecksum(content);
		const contentEncoding = compress
			? ContentEncoding.Gzip
			: ContentEncoding.None;
		const body = compress ? gzipSync(content) : content;

		await client.send(
			new PutObjectCommand({
				Bucket: bucketName,
				Key: key,
				Body: body,
				ContentType: contentType,
				ContentEncoding: compress ? "gzip" : undefined,
				ChecksumSHA256: Buffer.from(checksumSha256, "hex").toString("base64"),
			}),
		);

		return {
			uri: `s3://${bucketName}/${key}`,
			storageType: StorageType.S3,
			storageLocation: bucketName,
			storageKey: key,
			sizeBytes: body.length,
			checksumSha256,
			contentEncoding,
		};
	};

	const storeMessageBody: StorageService["storeMessageBody"] = (params) => {
		const { accountId, messageId, content } = params;
		return storeInternal({
			key: buildMessageBodyKey(accountId, messageId),
			content,
			contentType: "message/rfc822",
		});
	};

	const storeBodyPart: StorageService["storeBodyPart"] = (params) => {
		const { accountId, messageId, partPath, content, contentType } = params;
		return storeInternal({
			key: buildBodyPartKey(accountId, messageId, partPath),
			content,
			contentType,
		});
	};

	const storeDeduplicated: StorageService["storeDeduplicated"] = (params) => {
		const { accountId, content, contentType } = params;
		const checksumSha256 = computeChecksum(content);
		return storeInternal({
			key: buildDeduplicatedKey(accountId, checksumSha256),
			content,
			contentType,
		});
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

	return {
		storeMessageBody,
		storeBodyPart,
		storeDeduplicated,
		retrieve,
		exists,
		delete: del,
	};
};
