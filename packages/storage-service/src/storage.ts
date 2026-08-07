import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { ContentEncoding, StorageType } from "@remit/domain-enums";
import type {
	OutboxLedger,
	OutboxLedgerRead,
	OutboxLedgerVersion,
	OutboxLedgerWrite,
} from "./outbox-ledger.js";
import { parseOutboxLedger, serializeOutboxLedger } from "./outbox-ledger.js";

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

	/**
	 * Store a file attached to a draft outbox message, uncompressed: the size on
	 * the backend is then the decoded size the per-message cap is expressed in,
	 * and `listOutboxAttachments` can total a draft without opening anything.
	 */
	storeOutboxAttachment(
		params: StoreOutboxAttachmentParams,
	): Promise<StorageReference>;

	/**
	 * List the files stored against a draft, newest ordering unspecified, at most
	 * `limit` of them. The caller passes its own cap plus one so an over-full
	 * draft is recognisable without an unbounded read.
	 */
	listOutboxAttachments(
		accountConfigId: string,
		accountId: string,
		outboxMessageId: string,
		limit: number,
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
	 * Read a draft's ledger and the version token a write must present. A draft
	 * that has never held an attachment reads as empty with a null version.
	 */
	readOutboxLedger(
		accountConfigId: string,
		accountId: string,
		outboxMessageId: string,
	): Promise<OutboxLedgerRead>;

	/**
	 * Write a draft's ledger, but only if it still holds the version that was
	 * read. This is where the per-message cap is actually enforced: a mint reads,
	 * decides, and writes conditionally, so two mints in two processes cannot
	 * both believe there was room. `Stale` means the caller must reread and
	 * decide again.
	 */
	writeOutboxLedger(
		accountConfigId: string,
		accountId: string,
		outboxMessageId: string,
		ledger: OutboxLedger,
		expectedVersion: OutboxLedgerVersion,
	): Promise<OutboxLedgerWrite>;

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
// the edge can verify cross-tenant isolation at the URL prefix without
// loading any database record. The inner `accountId` distinguishes between
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

export const buildOutboxLedgerKey = (
	accountConfigId: string,
	accountId: string,
	outboxMessageId: string,
): string =>
	`accounts/${accountConfigId}/${accountId}/outbox/${outboxMessageId}/attachments.ledger`;

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
		limit,
	) => {
		const prefix = `mock://${buildOutboxAttachmentPrefix(accountConfigId, accountId, outboxMessageId)}`;
		const items: OutboxAttachmentListItem[] = [];
		for (const [uri, content] of storage.entries()) {
			if (items.length >= limit) break;
			if (!uri.startsWith(prefix)) continue;
			items.push({
				outboxAttachmentId: uri.slice(prefix.length),
				key: uri.slice("mock://".length),
				sizeBytes: content.length,
			});
		}
		return items;
	};

	const listOutboxDraftsWithAttachments: StorageService["listOutboxDraftsWithAttachments"] =
		async (accountConfigId, accountId) => {
			const root = `mock://accounts/${accountConfigId}/${accountId}/outbox/`;
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
				`mock://${buildOutboxAttachmentKey(accountConfigId, accountId, outboxMessageId, outboxAttachmentId)}`,
			);
		};

	// Stands in for a backend with a real compare-and-set: a version per ledger,
	// and a write that presents a stale one is refused rather than applied.
	const ledgerVersions = new Map<string, number>();

	const readOutboxLedger: StorageService["readOutboxLedger"] = async (
		accountConfigId,
		accountId,
		outboxMessageId,
	) => {
		const key = buildOutboxLedgerKey(
			accountConfigId,
			accountId,
			outboxMessageId,
		);
		const content = storage.get(`mock://${key}`);
		if (!content) return { ledger: { entries: [] }, version: null };
		return {
			ledger: parseOutboxLedger(content.toString("utf8")),
			version: String(ledgerVersions.get(key) ?? 0),
		};
	};

	const writeOutboxLedger: StorageService["writeOutboxLedger"] = async (
		accountConfigId,
		accountId,
		outboxMessageId,
		ledger,
		expectedVersion,
	) => {
		const key = buildOutboxLedgerKey(
			accountConfigId,
			accountId,
			outboxMessageId,
		);
		const uri = `mock://${key}`;
		const current = storage.has(uri)
			? String(ledgerVersions.get(key) ?? 0)
			: null;
		if (current !== expectedVersion) return "Stale";
		storage.set(uri, serializeOutboxLedger(ledger));
		ledgerVersions.set(key, (ledgerVersions.get(key) ?? 0) + 1);
		return "Written";
	};

	const statOutboxAttachment: StorageService["statOutboxAttachment"] = async (
		accountConfigId,
		accountId,
		outboxMessageId,
		outboxAttachmentId,
	) => {
		const content = storage.get(
			`mock://${buildOutboxAttachmentKey(accountConfigId, accountId, outboxMessageId, outboxAttachmentId)}`,
		);
		return content ? { sizeBytes: content.length } : null;
	};

	const createOutboxAttachmentUploadUrl: StorageService["createOutboxAttachmentUploadUrl"] =
		async (params) => ({
			uploadUrl: `mock://upload/${buildOutboxAttachmentKey(params.accountConfigId, params.accountId, params.outboxMessageId, params.outboxAttachmentId)}?max=${params.sizeBytes}&exp=${params.expiresAt}`,
		});

	const deleteOutboxAttachments: StorageService["deleteOutboxAttachments"] =
		async (accountConfigId, accountId, outboxMessageId) => {
			const prefix = `mock://${buildOutboxAttachmentPrefix(accountConfigId, accountId, outboxMessageId)}`;
			for (const uri of [...storage.keys()]) {
				if (uri.startsWith(prefix)) storage.delete(uri);
			}
			storage.delete(
				`mock://${buildOutboxLedgerKey(accountConfigId, accountId, outboxMessageId)}`,
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
		storeOutboxAttachment,
		listOutboxAttachments,
		listOutboxDraftsWithAttachments,
		deleteOutboxAttachments,
		deleteOutboxAttachment,
		readOutboxLedger,
		writeOutboxLedger,
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
