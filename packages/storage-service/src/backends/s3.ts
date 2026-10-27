import type { Readable } from "node:stream";
import { promisify } from "node:util";
import { createGunzip, gunzipSync, gzip } from "node:zlib";
import {
	DeleteObjectCommand,
	DeleteObjectsCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	type S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ContentEncoding, StorageType } from "@remit/domain-enums";
import type {
	OutboxAttachmentListItem,
	ParsedBody,
	StorageReference,
	StorageService,
} from "../storage.js";
import {
	buildBodyPartKey,
	buildDeduplicatedKey,
	buildExportArchiveKey,
	buildMessageBodyKey,
	buildOutboxAttachmentKey,
	buildOutboxAttachmentPrefix,
	buildParsedBodyKey,
	computeChecksum,
	isStorageNotFoundError,
} from "../storage.js";
import { parseStorageUri } from "../uri.js";

const gzipAsync = promisify(gzip);

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
		const body = compress ? await gzipAsync(content) : content;

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

	const bodyPartExists: StorageService["bodyPartExists"] = (
		accountConfigId,
		accountId,
		messageId,
		partPath,
	) => {
		const key = buildBodyPartKey(
			accountConfigId,
			accountId,
			messageId,
			partPath,
		);
		return client
			.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }))
			.then(() => true)
			.catch(() => false);
	};

	const retrieveBodyPart: StorageService["retrieveBodyPart"] = async (
		accountConfigId,
		accountId,
		messageId,
		partPath,
	) => {
		const key = buildBodyPartKey(
			accountConfigId,
			accountId,
			messageId,
			partPath,
		);

		const response = await client
			.send(new GetObjectCommand({ Bucket: bucketName, Key: key }))
			.catch((error: unknown) => {
				if (isStorageNotFoundError(error)) return null;
				throw error;
			});

		if (!response) return null;
		if (!response.Body) {
			throw new Error(`Empty response body for body part: ${key}`);
		}

		const body = await response.Body.transformToByteArray();
		const buffer = Buffer.from(body);
		return response.ContentEncoding === "gzip" ? gunzipSync(buffer) : buffer;
	};

	const storeOutboxAttachment: StorageService["storeOutboxAttachment"] = (
		params,
	) => {
		const {
			accountConfigId,
			accountId,
			outboxMessageId,
			outboxAttachmentId,
			content,
		} = params;
		// `application/octet-stream` rather than the uploader's declared type:
		// the object is only ever read back to build a MIME part, and a stored
		// `text/html` would be a type any future signed-URL read path could be
		// tricked into serving from the content origin.
		return storeInternal({
			key: buildOutboxAttachmentKey(
				accountConfigId,
				accountId,
				outboxMessageId,
				outboxAttachmentId,
			),
			content,
			contentType: "application/octet-stream",
			compress: false,
		});
	};

	const listOutboxAttachments: StorageService["listOutboxAttachments"] = async (
		accountConfigId,
		accountId,
		outboxMessageId,
	) => {
		const prefix = buildOutboxAttachmentPrefix(
			accountConfigId,
			accountId,
			outboxMessageId,
		);
		const items: OutboxAttachmentListItem[] = [];
		let continuationToken: string | undefined;

		do {
			const response = await client.send(
				new ListObjectsV2Command({
					Bucket: bucketName,
					Prefix: prefix,
					ContinuationToken: continuationToken,
				}),
			);
			for (const object of response.Contents ?? []) {
				if (!object.Key) continue;
				items.push({
					outboxAttachmentId: object.Key.slice(prefix.length),
					key: object.Key,
					sizeBytes: object.Size ?? 0,
				});
			}
			continuationToken = response.IsTruncated
				? response.NextContinuationToken
				: undefined;
		} while (continuationToken);

		return items;
	};

	const listOutboxDraftsWithAttachments: StorageService["listOutboxDraftsWithAttachments"] =
		async (accountConfigId, accountId) => {
			const root = `accounts/${accountConfigId}/${accountId}/outbox/`;
			const drafts = new Set<string>();
			let continuationToken: string | undefined;

			// Delimited listing: S3 answers with the directory-like prefixes rather
			// than every object under them, so this stays one call per page of
			// drafts instead of one per object.
			do {
				const response = await client.send(
					new ListObjectsV2Command({
						Bucket: bucketName,
						Prefix: root,
						Delimiter: "/",
						ContinuationToken: continuationToken,
					}),
				);
				for (const entry of response.CommonPrefixes ?? []) {
					if (!entry.Prefix) continue;
					drafts.add(entry.Prefix.slice(root.length).replace(/\/$/, ""));
				}
				continuationToken = response.IsTruncated
					? response.NextContinuationToken
					: undefined;
			} while (continuationToken);

			return [...drafts];
		};

	const deleteOutboxAttachment: StorageService["deleteOutboxAttachment"] =
		async (accountConfigId, accountId, outboxMessageId, outboxAttachmentId) => {
			const prefix = buildOutboxAttachmentPrefix(
				accountConfigId,
				accountId,
				outboxMessageId,
			);
			await client.send(
				new DeleteObjectCommand({
					Bucket: bucketName,
					Key: `${prefix}${outboxAttachmentId}`,
				}),
			);
		};

	const statOutboxAttachment: StorageService["statOutboxAttachment"] = async (
		accountConfigId,
		accountId,
		outboxMessageId,
		outboxAttachmentId,
	) => {
		const head = await client
			.send(
				new HeadObjectCommand({
					Bucket: bucketName,
					Key: buildOutboxAttachmentKey(
						accountConfigId,
						accountId,
						outboxMessageId,
						outboxAttachmentId,
					),
				}),
			)
			.catch((error: unknown) => {
				if (isStorageNotFoundError(error)) return null;
				// A HEAD on a missing key answers 404 with no NoSuchKey code, so the
				// SDK's NotFound is the same absence.
				if ((error as { name?: string })?.name === "NotFound") return null;
				throw error;
			});
		if (!head) return null;
		return { sizeBytes: head.ContentLength ?? 0 };
	};

	const retrieveOutboxAttachment: StorageService["retrieveOutboxAttachment"] =
		async (accountConfigId, accountId, outboxMessageId, outboxAttachmentId) => {
			const key = buildOutboxAttachmentKey(
				accountConfigId,
				accountId,
				outboxMessageId,
				outboxAttachmentId,
			);
			const response = await client
				.send(new GetObjectCommand({ Bucket: bucketName, Key: key }))
				.catch((error: unknown) => {
					if (isStorageNotFoundError(error)) return null;
					throw error;
				});
			if (!response) return null;
			if (!response.Body) {
				throw new Error(`Empty response body for outbox attachment: ${key}`);
			}
			const bytes = await response.Body.transformToByteArray();
			return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		};

	// The browser PUTs straight to the bucket and these bytes never touch the
	// API. `ContentLength` on the command hoists `content-length` into
	// X-Amz-SignedHeaders, so S3 recomputes the signature over the length it was
	// sent: a request declaring any other size fails the signature check, and a
	// PUT is read for exactly that many bytes. The size is bound by S3 itself,
	// not by anything downstream trusting the client.
	const createOutboxAttachmentUploadUrl: StorageService["createOutboxAttachmentUploadUrl"] =
		async (params) => {
			const expiresIn = Math.max(
				1,
				params.expiresAt - Math.floor(Date.now() / 1000),
			);
			const uploadUrl = await getSignedUrl(
				client,
				new PutObjectCommand({
					Bucket: bucketName,
					Key: buildOutboxAttachmentKey(
						params.accountConfigId,
						params.accountId,
						params.outboxMessageId,
						params.outboxAttachmentId,
					),
					ContentLength: params.sizeBytes,
				}),
				{ expiresIn },
			);
			return { uploadUrl };
		};

	const deleteOutboxAttachments: StorageService["deleteOutboxAttachments"] =
		async (accountConfigId, accountId, outboxMessageId) => {
			const prefix = buildOutboxAttachmentPrefix(
				accountConfigId,
				accountId,
				outboxMessageId,
			);
			let continuationToken: string | undefined;

			do {
				const response = await client.send(
					new ListObjectsV2Command({
						Bucket: bucketName,
						Prefix: prefix,
						ContinuationToken: continuationToken,
					}),
				);
				const keys = (response.Contents ?? [])
					.map((object) => object.Key)
					.filter((key): key is string => typeof key === "string");

				if (keys.length > 0) {
					await client.send(
						new DeleteObjectsCommand({
							Bucket: bucketName,
							Delete: { Objects: keys.map((Key) => ({ Key })) },
						}),
					);
				}

				continuationToken = response.IsTruncated
					? response.NextContinuationToken
					: undefined;
			} while (continuationToken);
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

	const retrieveMessageBody: StorageService["retrieveMessageBody"] = async (
		accountConfigId,
		accountId,
		messageId,
	) => {
		const key = buildMessageBodyKey(accountConfigId, accountId, messageId);

		const response = await client
			.send(new GetObjectCommand({ Bucket: bucketName, Key: key }))
			.catch((error: unknown) => {
				if (isStorageNotFoundError(error)) return null;
				throw error;
			});

		if (!response) return null;
		if (!response.Body) {
			throw new Error(`Empty response body for message body: ${key}`);
		}

		const body = await response.Body.transformToByteArray();
		const buffer = Buffer.from(body);
		return response.ContentEncoding === "gzip" ? gunzipSync(buffer) : buffer;
	};

	const retrieveMessageBodyStream: StorageService["retrieveMessageBodyStream"] =
		async (accountConfigId, accountId, messageId) => {
			const key = buildMessageBodyKey(accountConfigId, accountId, messageId);

			const response = await client
				.send(new GetObjectCommand({ Bucket: bucketName, Key: key }))
				.catch((error: unknown) => {
					if (isStorageNotFoundError(error)) return null;
					throw error;
				});

			if (!response) return null;
			if (!response.Body) {
				throw new Error(`Empty response body for message body: ${key}`);
			}

			const source = response.Body as Readable;
			if (response.ContentEncoding === "gzip") {
				return source.pipe(createGunzip());
			}
			return source;
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

	const storeExportArchiveStream = async (
		accountConfigId: string,
		exportRequestId: string,
		body: Readable,
	): Promise<string> => {
		const key = buildExportArchiveKey(accountConfigId, exportRequestId);
		const upload = new Upload({
			client,
			params: {
				Bucket: bucketName,
				Key: key,
				Body: body,
				ContentType: "application/zip",
			},
		});
		await upload.done().catch(async (error) => {
			await upload.abort().catch(() => {});
			throw error;
		});
		return key;
	};

	const getPresignedDownloadUrl = (
		key: string,
		expiresInSeconds: number,
	): Promise<string> =>
		getSignedUrl(
			client,
			new GetObjectCommand({ Bucket: bucketName, Key: key }),
			{ expiresIn: expiresInSeconds },
		);

	return {
		storeMessageBody,
		storeBodyPart,
		bodyPartExists,
		retrieveBodyPart,
		storeOutboxAttachment,
		listOutboxAttachments,
		listOutboxDraftsWithAttachments,
		deleteOutboxAttachments,
		deleteOutboxAttachment,
		statOutboxAttachment,
		retrieveOutboxAttachment,
		createOutboxAttachmentUploadUrl,
		storeDeduplicated,
		storeParsedBody,
		retrieveParsedBody,
		retrieveMessageBody,
		retrieveMessageBodyStream,
		retrieve,
		exists,
		delete: del,
		storeExportArchiveStream,
		getPresignedDownloadUrl,
	};
};
