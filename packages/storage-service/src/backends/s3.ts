import { gunzipSync, gzipSync } from "node:zlib";
import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	type S3Client,
} from "@aws-sdk/client-s3";
import { ContentEncoding, StorageType } from "@remit/domain-enums";
import type {
	ParsedBody,
	StorageReference,
	StorageService,
} from "../storage.js";
import {
	buildBodyPartKey,
	buildDeduplicatedKey,
	buildMessageBodyKey,
	buildParsedBodyKey,
	computeChecksum,
	isStorageNotFoundError,
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
		const contentChecksumSha256 = computeChecksum(content);
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
			}),
		);

		return {
			uri: `s3://${bucketName}/${key}`,
			storageType: StorageType.S3,
			storageLocation: bucketName,
			storageKey: key,
			sizeBytes: body.length,
			checksumSha256: contentChecksumSha256,
			contentEncoding,
		};
	};

	const storeMessageBody: StorageService["storeMessageBody"] = (params) => {
		const { accountConfigId, accountId, messageId, content } = params;
		return storeInternal({
			key: buildMessageBodyKey(accountConfigId, accountId, messageId),
			content,
			contentType: "message/rfc822",
		});
	};

	const storeBodyPart: StorageService["storeBodyPart"] = (params) => {
		const {
			accountConfigId,
			accountId,
			messageId,
			partPath,
			content,
			contentType,
		} = params;
		return storeInternal({
			key: buildBodyPartKey(accountConfigId, accountId, messageId, partPath),
			content,
			contentType,
		});
	};

	const storeDeduplicated: StorageService["storeDeduplicated"] = (params) => {
		const { accountConfigId, accountId, content, contentType } = params;
		const checksumSha256 = computeChecksum(content);
		return storeInternal({
			key: buildDeduplicatedKey(accountConfigId, accountId, checksumSha256),
			content,
			contentType,
		});
	};

	const storeParsedBody: StorageService["storeParsedBody"] = (params) => {
		const { accountConfigId, accountId, messageId, parsed } = params;
		const content = Buffer.from(JSON.stringify(parsed), "utf8");
		return storeInternal({
			key: buildParsedBodyKey(accountConfigId, accountId, messageId),
			content,
			contentType: "application/json",
		});
	};

	const retrieveParsedBody: StorageService["retrieveParsedBody"] = async (
		accountConfigId,
		accountId,
		messageId,
	) => {
		const key = buildParsedBodyKey(accountConfigId, accountId, messageId);

		const response = await client
			.send(new GetObjectCommand({ Bucket: bucketName, Key: key }))
			.catch((error: unknown) => {
				if (isStorageNotFoundError(error)) return null;
				throw error;
			});

		if (!response) return null;
		if (!response.Body) {
			throw new Error(`Empty response body for parsed body: ${key}`);
		}

		const body = await response.Body.transformToByteArray();
		const buffer = Buffer.from(body);
		const decoded =
			response.ContentEncoding === "gzip" ? gunzipSync(buffer) : buffer;
		return JSON.parse(decoded.toString("utf8")) as ParsedBody;
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
		storeParsedBody,
		retrieveParsedBody,
		retrieve,
		exists,
		delete: del,
	};
};
