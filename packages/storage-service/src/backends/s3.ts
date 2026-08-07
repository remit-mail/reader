import { createHash } from "node:crypto";
import { PassThrough, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip, gunzipSync, gzipSync } from "node:zlib";
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
	ExtractedTextListItem,
	OutboxAttachmentListItem,
	ParsedBody,
	StorageReference,
	StorageService,
} from "../storage.js";
import {
	buildBodyPartKey,
	buildDeduplicatedKey,
	buildExportArchiveKey,
	buildExtractedPrefix,
	buildExtractedSkippedKey,
	buildExtractedTextKey,
	buildMessageBodyKey,
	buildOutboxAttachmentKey,
	buildOutboxAttachmentPrefix,
	buildOutboxAttachmentReservationKey,
	buildParsedBodyKey,
	computeChecksum,
	isStorageNotFoundError,
	parseOutboxAttachmentEntry,
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

	const storeMessageBodyStream: StorageService["storeMessageBodyStream"] =
		async (params) => {
			const { accountConfigId, accountId, messageId, content } = params;
			const key = buildMessageBodyKey(accountConfigId, accountId, messageId);

			// Hash the logical (pre-gzip) bytes as they flow, gzip them, and feed
			// the gzipped stream to a multipart Upload — the whole body is never
			// held in memory. `Upload` buffers only one part at a time.
			const hash = createHash("sha256");
			const hashTap = new PassThrough();
			hashTap.on("data", (chunk: Buffer) => hash.update(chunk));

			const gzip = createGzip();
			const uploadBody = new PassThrough();

			let storedBytes = 0;
			uploadBody.on("data", (chunk: Buffer) => {
				storedBytes += chunk.length;
			});

			const upload = new Upload({
				client,
				params: {
					Bucket: bucketName,
					Key: key,
					Body: uploadBody,
					ContentType: "message/rfc822",
					ContentEncoding: "gzip",
				},
			});

			const pumped = pipeline(content, hashTap, gzip, uploadBody);
			await Promise.all([upload.done(), pumped]).catch(async (error) => {
				// Abort the multipart upload so a failed pump doesn't leak parts.
				await upload.abort().catch(() => {});
				throw error;
			});

			return {
				uri: `s3://${bucketName}/${key}`,
				storageType: StorageType.S3,
				storageLocation: bucketName,
				storageKey: key,
				sizeBytes: storedBytes,
				checksumSha256: hash.digest("hex"),
				contentEncoding: ContentEncoding.Gzip,
			};
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

	const storeExtractedText: StorageService["storeExtractedText"] = (params) => {
		const { accountConfigId, accountId, messageId, partPath, text } = params;
		return storeInternal({
			key: buildExtractedTextKey(
				accountConfigId,
				accountId,
				messageId,
				partPath,
			),
			content: Buffer.from(text, "utf8"),
			contentType: "text/plain; charset=utf-8",
		});
	};

	const storeExtractedSkipped: StorageService["storeExtractedSkipped"] = (
		params,
	) => {
		const { accountConfigId, accountId, messageId, partPath, marker } = params;
		return storeInternal({
			key: buildExtractedSkippedKey(
				accountConfigId,
				accountId,
				messageId,
				partPath,
			),
			content: Buffer.from(JSON.stringify(marker), "utf8"),
			contentType: "application/json",
			compress: false,
		});
	};

	const extractedResultExists: StorageService["extractedResultExists"] = async (
		accountConfigId,
		accountId,
		messageId,
		partPath,
	) => {
		const textKey = buildExtractedTextKey(
			accountConfigId,
			accountId,
			messageId,
			partPath,
		);
		const skippedKey = buildExtractedSkippedKey(
			accountConfigId,
			accountId,
			messageId,
			partPath,
		);

		const headExists = (key: string): Promise<boolean> =>
			client
				.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }))
				.then(() => true)
				.catch(() => false);

		const [textExists, skippedExists] = await Promise.all([
			headExists(textKey),
			headExists(skippedKey),
		]);
		return textExists || skippedExists;
	};

	const retrieveExtractedText: StorageService["retrieveExtractedText"] = async (
		accountConfigId,
		accountId,
		messageId,
		partPath,
	) => {
		const key = buildExtractedTextKey(
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
			throw new Error(`Empty response body for extracted text: ${key}`);
		}

		const body = await response.Body.transformToByteArray();
		const buffer = Buffer.from(body);
		const decoded =
			response.ContentEncoding === "gzip" ? gunzipSync(buffer) : buffer;
		return decoded.toString("utf8");
	};

	const listExtractedTexts: StorageService["listExtractedTexts"] = async (
		accountConfigId,
		accountId,
		messageId,
	) => {
		const prefix = buildExtractedPrefix(accountConfigId, accountId, messageId);
		const suffix = ".txt.gz";
		const items: ExtractedTextListItem[] = [];
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
				if (!object.Key || !object.Key.endsWith(suffix)) continue;
				items.push({
					partPath: object.Key.slice(prefix.length, -suffix.length),
					key: object.Key,
				});
			}
			continuationToken = response.IsTruncated
				? response.NextContinuationToken
				: undefined;
		} while (continuationToken);

		return items;
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
		limit,
	) => {
		const prefix = buildOutboxAttachmentPrefix(
			accountConfigId,
			accountId,
			outboxMessageId,
		);
		const response = await client.send(
			new ListObjectsV2Command({
				Bucket: bucketName,
				Prefix: prefix,
				MaxKeys: limit,
			}),
		);

		const items: OutboxAttachmentListItem[] = [];
		for (const object of response.Contents ?? []) {
			if (!object.Key) continue;
			const entry = parseOutboxAttachmentEntry(object.Key.slice(prefix.length));
			items.push({
				outboxAttachmentId: entry.outboxAttachmentId,
				key: object.Key,
				sizeBytes: entry.isReservation
					? entry.reservedBytes
					: (object.Size ?? 0),
				isReservation: entry.isReservation,
				expiresAt: entry.expiresAt,
			});
		}
		return items;
	};

	const deleteOutboxAttachment: StorageService["deleteOutboxAttachment"] =
		async (accountConfigId, accountId, outboxMessageId, outboxAttachmentId) => {
			const prefix = buildOutboxAttachmentPrefix(
				accountConfigId,
				accountId,
				outboxMessageId,
			);
			const response = await client.send(
				new ListObjectsV2Command({
					Bucket: bucketName,
					Prefix: `${prefix}${outboxAttachmentId}`,
				}),
			);
			const keys = (response.Contents ?? [])
				.map((object) => object.Key)
				.filter((key): key is string => typeof key === "string")
				.filter(
					(key) =>
						parseOutboxAttachmentEntry(key.slice(prefix.length))
							.outboxAttachmentId === outboxAttachmentId,
				);
			if (keys.length === 0) return;
			await client.send(
				new DeleteObjectsCommand({
					Bucket: bucketName,
					Delete: { Objects: keys.map((Key) => ({ Key })) },
				}),
			);
		};

	const reserveOutboxAttachment: StorageService["reserveOutboxAttachment"] =
		async (params) => {
			await client.send(
				new PutObjectCommand({
					Bucket: bucketName,
					Key: buildOutboxAttachmentReservationKey(
						params.accountConfigId,
						params.accountId,
						params.outboxMessageId,
						params.outboxAttachmentId,
						params.sizeBytes,
						params.expiresAt,
					),
					Body: Buffer.alloc(0),
				}),
			);
		};

	const releaseOutboxAttachmentReservation: StorageService["releaseOutboxAttachmentReservation"] =
		async (
			accountConfigId,
			accountId,
			outboxMessageId,
			outboxAttachmentId,
			sizeBytes,
			expiresAt,
		) => {
			await client.send(
				new DeleteObjectCommand({
					Bucket: bucketName,
					Key: buildOutboxAttachmentReservationKey(
						accountConfigId,
						accountId,
						outboxMessageId,
						outboxAttachmentId,
						sizeBytes,
						expiresAt,
					),
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
		storeMessageBodyStream,
		storeBodyPart,
		bodyPartExists,
		retrieveBodyPart,
		storeOutboxAttachment,
		listOutboxAttachments,
		deleteOutboxAttachments,
		deleteOutboxAttachment,
		reserveOutboxAttachment,
		releaseOutboxAttachmentReservation,
		statOutboxAttachment,
		createOutboxAttachmentUploadUrl,
		storeDeduplicated,
		storeParsedBody,
		retrieveParsedBody,
		storeExtractedText,
		storeExtractedSkipped,
		extractedResultExists,
		retrieveExtractedText,
		listExtractedTexts,
		retrieveMessageBody,
		retrieveMessageBodyStream,
		retrieve,
		exists,
		delete: del,
		storeExportArchiveStream,
		getPresignedDownloadUrl,
	};
};
