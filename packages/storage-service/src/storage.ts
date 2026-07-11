import { createHash } from "node:crypto";
import { Readable } from "node:stream";
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
	/**
	 * SHA-256 (hex) of the logical, pre-compression content.
	 * Identifies the content regardless of how it is stored on the backend,
	 * and is used by `buildDeduplicatedKey` for content-addressable storage.
	 * Note: this is NOT the checksum S3 validates against the received bytes —
	 * S3's own transport-level checksum is handled by the SDK on PUT.
	 */
	checksumSha256: string;
	contentEncoding: ContentEncodingValue;
}

/** Parameters for storing a message body (raw RFC822 content) */
export interface StoreMessageBodyParams {
	accountConfigId: string;
	accountId: string;
	messageId: string;
	content: Buffer;
}

/** Parameters for streaming a message body (raw RFC822 content) to storage */
export interface StoreMessageBodyStreamParams {
	accountConfigId: string;
	accountId: string;
	messageId: string;
	/** Readable stream of the raw message bytes; streamed to storage, never buffered whole. */
	content: Readable;
}

/** Parameters for storing a body part (attachment, inline content) */
export interface StoreBodyPartParams {
	accountConfigId: string;
	accountId: string;
	messageId: string;
	partPath: string;
	content: Buffer;
	contentType?: string;
}

/** Parameters for storing deduplicated content (attachments shared across messages) */
export interface StoreDeduplicatedParams {
	accountConfigId: string;
	accountId: string;
	content: Buffer;
	contentType?: string;
}

/** Metadata for a single attachment in a parsed message body. No binary content. */
export interface ParsedAttachmentMeta {
	filename: string | null;
	contentType: string;
	contentDisposition: string | null;
	contentId: string | null;
	size: number;
}

/** Pre-parsed message body cached as parsed.json.gz to skip mailparser on warm reads */
export interface ParsedBody {
	text: string | null;
	html: string | null;
	attachments: ParsedAttachmentMeta[];
}

/** Parameters for storing a pre-parsed message body */
export interface StoreParsedBodyParams {
	accountConfigId: string;
	accountId: string;
	messageId: string;
	parsed: ParsedBody;
}

/** Parameters for storing extracted attachment text (attachment-scan worker, #450) */
export interface StoreExtractedTextParams {
	accountConfigId: string;
	accountId: string;
	messageId: string;
	partPath: string;
	text: string;
}

/**
 * Marker written in place of extracted text when extraction is skipped or
 * fails, so the idempotency check terminates retries on a poison or
 * unsupported attachment instead of re-running extraction on every
 * redelivery.
 */
export interface ExtractedTextMarker {
	status: "skipped" | "failed";
	reason: string;
}

/** Parameters for storing an extraction skip/failure marker */
export interface StoreExtractedSkippedParams {
	accountConfigId: string;
	accountId: string;
	messageId: string;
	partPath: string;
	marker: ExtractedTextMarker;
}

/** One extracted-text artifact found under a message's `extracted/` prefix */
export interface ExtractedTextListItem {
	partPath: string;
	key: string;
}

export interface StorageService {
	/** Store a message body (raw RFC822 content) */
	storeMessageBody(params: StoreMessageBodyParams): Promise<StorageReference>;

	/**
	 * Store a message body from a readable stream, never buffering the whole
	 * body. Use this on the sync hot path so a ranged FETCH streams straight to
	 * storage.
	 */
	storeMessageBodyStream(
		params: StoreMessageBodyStreamParams,
	): Promise<StorageReference>;

	/** Store a body part (attachment, inline content) */
	storeBodyPart(params: StoreBodyPartParams): Promise<StorageReference>;

	/**
	 * Check whether a body-part object already exists, keyed exactly as
	 * `storeBodyPart` writes it. Used by the lazy per-part generation path to
	 * skip leaves already materialized on a prior read, so regeneration is
	 * idempotent and re-reads stay cheap.
	 */
	bodyPartExists(
		accountConfigId: string,
		accountId: string,
		messageId: string,
		partPath: string,
	): Promise<boolean>;

	/**
	 * Retrieve a body-part's content (attachment or inline leaf) by
	 * account/message id and IMAP section path; returns null on NoSuchKey.
	 */
	retrieveBodyPart(
		accountConfigId: string,
		accountId: string,
		messageId: string,
		partPath: string,
	): Promise<Buffer | null>;

	/** Store deduplicated content (content-addressable, for attachments) */
	storeDeduplicated(params: StoreDeduplicatedParams): Promise<StorageReference>;

	/** Store a pre-parsed message body as gzipped JSON (parsed-body cache) */
	storeParsedBody(params: StoreParsedBodyParams): Promise<StorageReference>;

	/** Retrieve a pre-parsed message body by account/message id; returns null on NoSuchKey */
	retrieveParsedBody(
		accountConfigId: string,
		accountId: string,
		messageId: string,
	): Promise<ParsedBody | null>;

	/** Store extracted attachment text (attachment-scan worker, #450) */
	storeExtractedText(
		params: StoreExtractedTextParams,
	): Promise<StorageReference>;

	/** Store a skip/failure marker in place of extracted text */
	storeExtractedSkipped(
		params: StoreExtractedSkippedParams,
	): Promise<StorageReference>;

	/**
	 * Whether an extraction result — either the text artifact or the
	 * skip/failure marker — already exists for this part. Makes extraction
	 * idempotent: a redelivered SQS message short-circuits instead of
	 * re-running extraction (#450).
	 */
	extractedResultExists(
		accountConfigId: string,
		accountId: string,
		messageId: string,
		partPath: string,
	): Promise<boolean>;

	/** Retrieve previously extracted text; returns null on NoSuchKey */
	retrieveExtractedText(
		accountConfigId: string,
		accountId: string,
		messageId: string,
		partPath: string,
	): Promise<string | null>;

	/**
	 * List every extracted-text artifact stored for a message — the
	 * `.skipped.json` markers are excluded. Used by the search-index worker
	 * (#452) to fold attachment text into a message's vectors.
	 */
	listExtractedTexts(
		accountConfigId: string,
		accountId: string,
		messageId: string,
	): Promise<ExtractedTextListItem[]>;

	/** Retrieve a raw message body (RFC822 .eml) by account/message id; returns null on NoSuchKey */
	retrieveMessageBody(
		accountConfigId: string,
		accountId: string,
		messageId: string,
	): Promise<Buffer | null>;

	/**
	 * Retrieve a raw message body as a readable stream of decompressed .eml
	 * bytes; returns null on NoSuchKey. Use on the export path so a whole
	 * mailbox is never buffered in memory.
	 */
	retrieveMessageBodyStream(
		accountConfigId: string,
		accountId: string,
		messageId: string,
	): Promise<Readable | null>;

	/** Retrieve content by URI */
	retrieve(uri: string): Promise<Buffer>;

	/** Check if content exists */
	exists(uri: string): Promise<boolean>;

	/** Delete content by URI */
	delete(uri: string): Promise<void>;

	/**
	 * Stream a finished export archive (already-compressed ZIP) to the export
	 * key for the given config + request, uncompressed at rest. The body is
	 * streamed via a multipart upload and never buffered whole. Returns the raw
	 * storage key, which `getPresignedDownloadUrl` can then sign.
	 */
	storeExportArchiveStream(
		accountConfigId: string,
		exportRequestId: string,
		body: Readable,
	): Promise<string>;

	/**
	 * Generate a presigned URL that grants temporary GET access to a raw S3 key.
	 * Use for export archives — the key must already exist in the bucket.
	 * Not supported on filesystem backends; throws if called there.
	 */
	getPresignedDownloadUrl(
		key: string,
		expiresInSeconds: number,
	): Promise<string>;
}

// Path builders - centralized path formatting per RFC 011 + #224.
// The outer segment is `accountConfigId` (Cognito-derived tenant scope) so
// the Lambda@Edge can verify cross-tenant isolation at the URL prefix without
// loading any DynamoDB record. The inner `accountId` distinguishes between
// multiple IMAP-account records owned by the same tenant.
export const buildMessageBodyKey = (
	accountConfigId: string,
	accountId: string,
	messageId: string,
): string =>
	`accounts/${accountConfigId}/${accountId}/messages/${messageId}/body.eml`;

export const buildParsedBodyKey = (
	accountConfigId: string,
	accountId: string,
	messageId: string,
): string =>
	`accounts/${accountConfigId}/${accountId}/messages/${messageId}/parsed.json.gz`;

export const buildBodyPartKey = (
	accountConfigId: string,
	accountId: string,
	messageId: string,
	partPath: string,
): string =>
	`accounts/${accountConfigId}/${accountId}/messages/${messageId}/parts/${partPath}`;

export const buildExtractedTextKey = (
	accountConfigId: string,
	accountId: string,
	messageId: string,
	partPath: string,
): string =>
	`${buildExtractedPrefix(accountConfigId, accountId, messageId)}${partPath}.txt.gz`;

export const buildExtractedSkippedKey = (
	accountConfigId: string,
	accountId: string,
	messageId: string,
	partPath: string,
): string =>
	`${buildExtractedPrefix(accountConfigId, accountId, messageId)}${partPath}.skipped.json`;

export const buildExtractedPrefix = (
	accountConfigId: string,
	accountId: string,
	messageId: string,
): string =>
	`accounts/${accountConfigId}/${accountId}/messages/${messageId}/extracted/`;

export const buildDeduplicatedKey = (
	accountConfigId: string,
	accountId: string,
	checksumSha256: string,
): string =>
	`accounts/${accountConfigId}/${accountId}/dedup/${checksumSha256.slice(0, 2)}/${checksumSha256}`;

export interface ParsedContentStorageKey {
	accountConfigId: string;
	accountId: string;
	messageId: string;
}

/**
 * Parse the account/message ids out of a `/content/*` storage key such as
 * `accounts/{accountConfigId}/{accountId}/messages/{messageId}/parts/1.2`
 * (the inverse of `buildMessageBodyKey`/`buildParsedBodyKey`/`buildBodyPartKey`
 * above). Returns null when the shape doesn't match.
 */
export const parseContentStorageKey = (
	storageKey: string,
): ParsedContentStorageKey | null => {
	const match = storageKey.match(
		/^accounts\/([^/]+)\/([^/]+)\/messages\/([^/]+)\//,
	);
	if (!match) return null;
	return {
		accountConfigId: match[1],
		accountId: match[2],
		messageId: match[3],
	};
};

export const computeChecksum = (content: Buffer): string =>
	createHash("sha256").update(content).digest("hex");

export const buildExportArchiveKey = (
	accountConfigId: string,
	exportRequestId: string,
): string => `exports/${accountConfigId}/${exportRequestId}/export.zip`;

export const isStorageNotFoundError = (error: unknown): boolean => {
	if (typeof error !== "object" || error === null) return false;
	const obj = error as Record<string, unknown>;
	if (obj.name === "NoSuchKey") return true;
	if (obj.Code === "NoSuchKey") return true;
	if (obj.code === "ENOENT") return true;
	return false;
};

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
		const { accountConfigId, accountId, messageId, content } = params;
		return storeInternal(
			buildMessageBodyKey(accountConfigId, accountId, messageId),
			content,
		);
	};

	const storeMessageBodyStream: StorageService["storeMessageBodyStream"] =
		async (params) => {
			const { accountConfigId, accountId, messageId, content } = params;
			const chunks: Buffer[] = [];
			for await (const chunk of content) {
				chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
			}
			return storeInternal(
				buildMessageBodyKey(accountConfigId, accountId, messageId),
				Buffer.concat(chunks),
			);
		};

	const storeBodyPart: StorageService["storeBodyPart"] = async (params) => {
		const { accountConfigId, accountId, messageId, partPath, content } = params;
		return storeInternal(
			buildBodyPartKey(accountConfigId, accountId, messageId, partPath),
			content,
		);
	};

	const storeDeduplicated: StorageService["storeDeduplicated"] = async (
		params,
	) => {
		const { accountConfigId, accountId, content } = params;
		const checksumSha256 = computeChecksum(content);
		return storeInternal(
			buildDeduplicatedKey(accountConfigId, accountId, checksumSha256),
			content,
		);
	};

	const storeParsedBody: StorageService["storeParsedBody"] = async (params) => {
		const { accountConfigId, accountId, messageId, parsed } = params;
		const content = Buffer.from(JSON.stringify(parsed), "utf8");
		return storeInternal(
			buildParsedBodyKey(accountConfigId, accountId, messageId),
			content,
		);
	};

	const retrieveParsedBody: StorageService["retrieveParsedBody"] = async (
		accountConfigId,
		accountId,
		messageId,
	) => {
		const uri = `mock://${buildParsedBodyKey(accountConfigId, accountId, messageId)}`;
		const content = storage.get(uri);
		if (!content) return null;
		return JSON.parse(content.toString("utf8")) as ParsedBody;
	};

	const retrieveBodyPart: StorageService["retrieveBodyPart"] = async (
		accountConfigId,
		accountId,
		messageId,
		partPath,
	) => {
		const uri = `mock://${buildBodyPartKey(accountConfigId, accountId, messageId, partPath)}`;
		return storage.get(uri) ?? null;
	};

	const storeExtractedText: StorageService["storeExtractedText"] = async (
		params,
	) => {
		const { accountConfigId, accountId, messageId, partPath, text } = params;
		return storeInternal(
			buildExtractedTextKey(accountConfigId, accountId, messageId, partPath),
			Buffer.from(text, "utf8"),
		);
	};

	const storeExtractedSkipped: StorageService["storeExtractedSkipped"] = async (
		params,
	) => {
		const { accountConfigId, accountId, messageId, partPath, marker } = params;
		return storeInternal(
			buildExtractedSkippedKey(accountConfigId, accountId, messageId, partPath),
			Buffer.from(JSON.stringify(marker), "utf8"),
		);
	};

	const extractedResultExists: StorageService["extractedResultExists"] = async (
		accountConfigId,
		accountId,
		messageId,
		partPath,
	) => {
		const textUri = `mock://${buildExtractedTextKey(accountConfigId, accountId, messageId, partPath)}`;
		const skippedUri = `mock://${buildExtractedSkippedKey(accountConfigId, accountId, messageId, partPath)}`;
		return storage.has(textUri) || storage.has(skippedUri);
	};

	const retrieveExtractedText: StorageService["retrieveExtractedText"] = async (
		accountConfigId,
		accountId,
		messageId,
		partPath,
	) => {
		const uri = `mock://${buildExtractedTextKey(accountConfigId, accountId, messageId, partPath)}`;
		const content = storage.get(uri);
		if (!content) return null;
		return content.toString("utf8");
	};

	const listExtractedTexts: StorageService["listExtractedTexts"] = async (
		accountConfigId,
		accountId,
		messageId,
	) => {
		const prefix = `mock://${buildExtractedPrefix(accountConfigId, accountId, messageId)}`;
		const suffix = ".txt.gz";
		const items: ExtractedTextListItem[] = [];
		for (const uri of storage.keys()) {
			if (!uri.startsWith(prefix) || !uri.endsWith(suffix)) continue;
			const key = uri.slice("mock://".length);
			items.push({
				partPath: uri.slice(prefix.length, -suffix.length),
				key,
			});
		}
		return items;
	};

	const retrieveMessageBody: StorageService["retrieveMessageBody"] = async (
		accountConfigId,
		accountId,
		messageId,
	) => {
		const uri = `mock://${buildMessageBodyKey(accountConfigId, accountId, messageId)}`;
		return storage.get(uri) ?? null;
	};

	const retrieveMessageBodyStream: StorageService["retrieveMessageBodyStream"] =
		async (accountConfigId, accountId, messageId) => {
			const uri = `mock://${buildMessageBodyKey(accountConfigId, accountId, messageId)}`;
			const content = storage.get(uri);
			if (!content) return null;
			return Readable.from(content);
		};

	const bodyPartExists: StorageService["bodyPartExists"] = async (
		accountConfigId,
		accountId,
		messageId,
		partPath,
	) => {
		const uri = `mock://${buildBodyPartKey(accountConfigId, accountId, messageId, partPath)}`;
		return storage.has(uri);
	};

	return {
		storeMessageBody,
		storeMessageBodyStream,
		storeBodyPart,
		bodyPartExists,
		retrieveBodyPart,
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
		retrieve: async (uri) => {
			const content = storage.get(uri);
			if (!content) {
				throw Object.assign(new Error(`Not found: ${uri}`), {
					name: "NoSuchKey",
				});
			}
			return content;
		},
		exists: async (uri) => storage.has(uri),
		delete: async (uri) => {
			storage.delete(uri);
		},
		storeExportArchiveStream: async (
			accountConfigId,
			exportRequestId,
			body,
		) => {
			const key = buildExportArchiveKey(accountConfigId, exportRequestId);
			const chunks: Buffer[] = [];
			for await (const chunk of body) {
				chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
			}
			storage.set(`mock://${key}`, Buffer.concat(chunks));
			return key;
		},
		getPresignedDownloadUrl: async (key: string, _expiresInSeconds: number) =>
			`mock://presigned/${key}`,
	};
};
