import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { ContentEncoding, StorageType } from "@remit/domain-enums";
import { parseStorageUri } from "./uri.js";

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

/** Parameters for storing a body part (attachment, inline content) */
export interface StoreBodyPartParams {
	accountConfigId: string;
	accountId: string;
	messageId: string;
	partPath: string;
	content: Buffer;
	contentType?: string;
}

/**
 * Parameters for storing a file attached to a draft outbox message.
 *
 * Deliberately not the deduplicated path: a content-addressed object belongs to
 * no single draft, so nothing may delete it when the draft goes. A per-draft key
 * dies with the draft.
 */
export interface StoreOutboxAttachmentParams {
	accountConfigId: string;
	accountId: string;
	outboxMessageId: string;
	outboxAttachmentId: string;
	content: Buffer;
}

/**
 * One uploaded object under a draft's attachment prefix. Reservations are not
 * here — they live in the ledger, which is the only thing that can say whether
 * an object present in storage is an attachment or garbage.
 */
export interface OutboxAttachmentListItem {
	outboxAttachmentId: string;
	key: string;
	sizeBytes: number;
}

/** Somewhere for a client to PUT one file, for a while */
export interface OutboxAttachmentUploadTarget {
	/**
	 * Absolute URL the client PUTs raw bytes to. Opaque by design: block storage
	 * on one deployment, this deployment's own upload route on another, and a
	 * client cannot tell which it was handed.
	 */
	uploadUrl: string;
}

export interface CreateOutboxAttachmentUploadUrlParams {
	accountConfigId: string;
	accountId: string;
	outboxMessageId: string;
	outboxAttachmentId: string;
	/** Exact byte count the upload may carry. */
	sizeBytes: number;
	expiresAt: number;
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

export interface StorageService {
	/** Store a message body (raw RFC822 content) */
	storeMessageBody(params: StoreMessageBodyParams): Promise<StorageReference>;

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

	/**
	 * Store a file attached to a draft outbox message, uncompressed: the size on
	 * the backend is then the decoded size the per-message cap is expressed in,
	 * and `listOutboxAttachments` can total a draft without opening anything.
	 */
	storeOutboxAttachment(
		params: StoreOutboxAttachmentParams,
	): Promise<StorageReference>;

	/**
	 * Every object stored against a draft, paged to the end. Only the sweep reads
	 * this, and a sweep that stops early leaves exactly the orphan it was called
	 * to collect — so there is no limit to get wrong.
	 */
	listOutboxAttachments(
		accountConfigId: string,
		accountId: string,
		outboxMessageId: string,
	): Promise<OutboxAttachmentListItem[]>;

	/**
	 * Remove every file and reservation stored against a draft. Unlike the read
	 * above this takes no limit and pages to the end: a sweep that stops early
	 * leaves exactly the orphan it was called to prevent.
	 */
	deleteOutboxAttachments(
		accountConfigId: string,
		accountId: string,
		outboxMessageId: string,
	): Promise<void>;

	/**
	 * Remove every object stored under a message: its body, parsed body and
	 * parts. Deleting a message with nothing stored is a no-op.
	 */
	deleteMessageObjects(
		accountConfigId: string,
		accountId: string,
		messageId: string,
	): Promise<void>;

	/**
	 * Every draft under an account that has attachment objects in storage,
	 * including drafts whose row is long gone. The sweep needs the prefixes that
	 * exist, not the rows that exist — a discarded draft is invisible to the
	 * database and is exactly the case worth collecting.
	 */
	listOutboxDraftsWithAttachments(
		accountConfigId: string,
		accountId: string,
	): Promise<string[]>;

	/** Remove one attachment object. */
	deleteOutboxAttachment(
		accountConfigId: string,
		accountId: string,
		outboxMessageId: string,
		outboxAttachmentId: string,
	): Promise<void>;

	/**
	 * The size storage actually holds for an attachment, or null when nothing
	 * was uploaded. This is the only number a completion may believe — the
	 * client's word for it is not evidence, and on a deployment where the bytes
	 * went straight to block storage it is the only reading available.
	 */
	statOutboxAttachment(
		accountConfigId: string,
		accountId: string,
		outboxMessageId: string,
		outboxAttachmentId: string,
	): Promise<{ sizeBytes: number } | null>;

	/**
	 * The bytes of one attachment, for building the MIME part it goes out as.
	 * Null when nothing is stored under the key.
	 */
	retrieveOutboxAttachment(
		accountConfigId: string,
		accountId: string,
		outboxMessageId: string,
		outboxAttachmentId: string,
	): Promise<Buffer | null>;

	/**
	 * Mint somewhere to PUT one file. The backend decides what that is — block
	 * storage direct, or this deployment's upload route — and the caller never
	 * branches on which it got. Whatever it returns must bind the size: an
	 * upload that carries more than was reserved has to fail at the thing
	 * receiving it, not afterwards.
	 */
	createOutboxAttachmentUploadUrl(
		params: CreateOutboxAttachmentUploadUrlParams,
	): Promise<OutboxAttachmentUploadTarget>;

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
	 * Delete the export archive of the given config + request. Deleting a
	 * missing archive is a no-op.
	 */
	deleteExportArchive(
		accountConfigId: string,
		exportRequestId: string,
	): Promise<void>;

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
// the edge can verify cross-tenant isolation at the URL prefix without
// loading any database record. The inner `accountId` distinguishes between
// multiple IMAP-account records owned by the same tenant.
export const buildMessageObjectPrefix = (
	accountConfigId: string,
	accountId: string,
	messageId: string,
): string => `accounts/${accountConfigId}/${accountId}/messages/${messageId}/`;

export const buildMessageBodyKey = (
	accountConfigId: string,
	accountId: string,
	messageId: string,
): string =>
	`${buildMessageObjectPrefix(accountConfigId, accountId, messageId)}body.eml`;

export const buildParsedBodyKey = (
	accountConfigId: string,
	accountId: string,
	messageId: string,
): string =>
	`${buildMessageObjectPrefix(accountConfigId, accountId, messageId)}parsed.json.gz`;

export const buildBodyPartKey = (
	accountConfigId: string,
	accountId: string,
	messageId: string,
	partPath: string,
): string =>
	`${buildMessageObjectPrefix(accountConfigId, accountId, messageId)}parts/${partPath}`;

export const buildOutboxAttachmentPrefix = (
	accountConfigId: string,
	accountId: string,
	outboxMessageId: string,
): string =>
	`accounts/${accountConfigId}/${accountId}/outbox/${outboxMessageId}/attachments/`;

export const buildOutboxAttachmentKey = (
	accountConfigId: string,
	accountId: string,
	outboxMessageId: string,
	outboxAttachmentId: string,
): string =>
	`${buildOutboxAttachmentPrefix(accountConfigId, accountId, outboxMessageId)}${outboxAttachmentId}`;

// Every segment is a generated id, so the shape is closed rather than
// "anything without a slash": `..` matches `[^/]+` and the write side joins
// this key onto a filesystem root. The read side has `resolveContentPath` for
// the same reason (#310 review P1) — a signature should not be the only thing
// standing between a URL and the storage root.
const OUTBOX_ATTACHMENT_KEY =
	/^accounts\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/outbox\/([A-Za-z0-9_-]+)\/attachments\/([A-Za-z0-9_-]+)$/;
export interface ParsedOutboxAttachmentKey {
	accountConfigId: string;
	accountId: string;
	outboxMessageId: string;
	outboxAttachmentId: string;
}

/**
 * Read the ids back out of an attachment key — the inverse of
 * `buildOutboxAttachmentKey`, for the upload route, which is handed a path and
 * has to work out what it addresses. Returns null on anything else, including a
 * reservation key: bytes are never written to one.
 */
export const parseOutboxAttachmentKey = (
	storageKey: string,
): ParsedOutboxAttachmentKey | null => {
	const match = storageKey.match(OUTBOX_ATTACHMENT_KEY);
	if (!match) return null;
	return {
		accountConfigId: match[1],
		accountId: match[2],
		outboxMessageId: match[3],
		outboxAttachmentId: match[4],
	};
};

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

export const parseMessageBodyUri = (
	uri: string,
): ParsedContentStorageKey | null => {
	const path = `/${parseStorageUri(uri).storageKey}`;
	const start = path.lastIndexOf("/accounts/", path.lastIndexOf("/messages/"));
	if (start < 0) return null;
	return parseContentStorageKey(path.slice(start + 1));
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

const MOCK_ROOT = "s3://mock/";

export const createMockStorageService = (): StorageService => {
	const storage = new Map<string, Buffer>();

	const storeInternal = (key: string, content: Buffer): StorageReference => {
		const checksumSha256 = computeChecksum(content);
		const uri = `${MOCK_ROOT}${key}`;
		storage.set(uri, content);
		return {
			uri,
			storageType: StorageType.S3,
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

	const storeBodyPart: StorageService["storeBodyPart"] = async (params) => {
		const { accountConfigId, accountId, messageId, partPath, content } = params;
		return storeInternal(
			buildBodyPartKey(accountConfigId, accountId, messageId, partPath),
			content,
		);
	};

	const storeOutboxAttachment: StorageService["storeOutboxAttachment"] = async (
		params,
	) => {
		const {
			accountConfigId,
			accountId,
			outboxMessageId,
			outboxAttachmentId,
			content,
		} = params;
		return storeInternal(
			buildOutboxAttachmentKey(
				accountConfigId,
				accountId,
				outboxMessageId,
				outboxAttachmentId,
			),
			content,
		);
	};

	const listOutboxAttachments: StorageService["listOutboxAttachments"] = async (
		accountConfigId,
		accountId,
		outboxMessageId,
	) => {
		const prefix = `${MOCK_ROOT}${buildOutboxAttachmentPrefix(accountConfigId, accountId, outboxMessageId)}`;
		const items: OutboxAttachmentListItem[] = [];
		for (const [uri, content] of storage.entries()) {
			if (!uri.startsWith(prefix)) continue;
			items.push({
				outboxAttachmentId: uri.slice(prefix.length),
				key: uri.slice(MOCK_ROOT.length),
				sizeBytes: content.length,
			});
		}
		return items;
	};

	const listOutboxDraftsWithAttachments: StorageService["listOutboxDraftsWithAttachments"] =
		async (accountConfigId, accountId) => {
			const root = `${MOCK_ROOT}accounts/${accountConfigId}/${accountId}/outbox/`;
			const drafts = new Set<string>();
			for (const uri of storage.keys()) {
				if (!uri.startsWith(root)) continue;
				const rest = uri.slice(root.length);
				const slash = rest.indexOf("/");
				if (slash > 0) drafts.add(rest.slice(0, slash));
			}
			return [...drafts];
		};

	const deleteOutboxAttachment: StorageService["deleteOutboxAttachment"] =
		async (accountConfigId, accountId, outboxMessageId, outboxAttachmentId) => {
			storage.delete(
				`${MOCK_ROOT}${buildOutboxAttachmentKey(accountConfigId, accountId, outboxMessageId, outboxAttachmentId)}`,
			);
		};

	const statOutboxAttachment: StorageService["statOutboxAttachment"] = async (
		accountConfigId,
		accountId,
		outboxMessageId,
		outboxAttachmentId,
	) => {
		const content = storage.get(
			`${MOCK_ROOT}${buildOutboxAttachmentKey(accountConfigId, accountId, outboxMessageId, outboxAttachmentId)}`,
		);
		return content ? { sizeBytes: content.length } : null;
	};

	const retrieveOutboxAttachment: StorageService["retrieveOutboxAttachment"] =
		async (accountConfigId, accountId, outboxMessageId, outboxAttachmentId) =>
			storage.get(
				`${MOCK_ROOT}${buildOutboxAttachmentKey(accountConfigId, accountId, outboxMessageId, outboxAttachmentId)}`,
			) ?? null;

	const createOutboxAttachmentUploadUrl: StorageService["createOutboxAttachmentUploadUrl"] =
		async (params) => ({
			uploadUrl: `mock://upload/${buildOutboxAttachmentKey(params.accountConfigId, params.accountId, params.outboxMessageId, params.outboxAttachmentId)}?max=${params.sizeBytes}&exp=${params.expiresAt}`,
		});

	const deletePrefix = async (prefix: string): Promise<void> => {
		for (const uri of [...storage.keys()]) {
			if (uri.startsWith(`${MOCK_ROOT}${prefix}`)) storage.delete(uri);
		}
	};

	const deleteOutboxAttachments: StorageService["deleteOutboxAttachments"] = (
		accountConfigId,
		accountId,
		outboxMessageId,
	) =>
		deletePrefix(
			buildOutboxAttachmentPrefix(accountConfigId, accountId, outboxMessageId),
		);

	const deleteMessageObjects: StorageService["deleteMessageObjects"] = (
		accountConfigId,
		accountId,
		messageId,
	) =>
		deletePrefix(
			buildMessageObjectPrefix(accountConfigId, accountId, messageId),
		);

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
		const uri = `${MOCK_ROOT}${buildParsedBodyKey(accountConfigId, accountId, messageId)}`;
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
		const uri = `${MOCK_ROOT}${buildBodyPartKey(accountConfigId, accountId, messageId, partPath)}`;
		return storage.get(uri) ?? null;
	};

	const retrieveMessageBody: StorageService["retrieveMessageBody"] = async (
		accountConfigId,
		accountId,
		messageId,
	) => {
		const uri = `${MOCK_ROOT}${buildMessageBodyKey(accountConfigId, accountId, messageId)}`;
		return storage.get(uri) ?? null;
	};

	const retrieveMessageBodyStream: StorageService["retrieveMessageBodyStream"] =
		async (accountConfigId, accountId, messageId) => {
			const uri = `${MOCK_ROOT}${buildMessageBodyKey(accountConfigId, accountId, messageId)}`;
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
		const uri = `${MOCK_ROOT}${buildBodyPartKey(accountConfigId, accountId, messageId, partPath)}`;
		return storage.has(uri);
	};

	return {
		storeMessageBody,
		storeBodyPart,
		bodyPartExists,
		retrieveBodyPart,
		storeOutboxAttachment,
		listOutboxAttachments,
		listOutboxDraftsWithAttachments,
		deleteOutboxAttachments,
		deleteMessageObjects,
		deleteOutboxAttachment,
		statOutboxAttachment,
		retrieveOutboxAttachment,
		createOutboxAttachmentUploadUrl,
		storeDeduplicated,
		storeParsedBody,
		retrieveParsedBody,
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
			storage.set(`${MOCK_ROOT}${key}`, Buffer.concat(chunks));
			return key;
		},
		deleteExportArchive: async (accountConfigId, exportRequestId) => {
			storage.delete(
				`${MOCK_ROOT}${buildExportArchiveKey(accountConfigId, exportRequestId)}`,
			);
		},
		getPresignedDownloadUrl: async (key: string, _expiresInSeconds: number) =>
			`mock://presigned/${key}`,
	};
};
