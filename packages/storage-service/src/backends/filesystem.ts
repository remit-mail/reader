import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip, gunzipSync, gzipSync } from "node:zlib";
import { ContentEncoding, StorageType } from "@remit/domain-enums";
import {
	UPLOAD_ROUTE_PREFIX,
	UPLOAD_URL_SIGNING_LABEL,
} from "../outbox-upload-url.js";
import { signStoragePath } from "../signed-path.js";
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

interface StoreParams {
	key: string;
	content: Buffer;
	compress?: boolean;
}

/**
 * Where a minted upload URL points, and what signs it. Absent on a process that
 * only reads storage; a mint then fails loud rather than handing out a URL
 * nothing can verify.
 */
export interface FilesystemUploadUrlConfig {
	/** Public origin of the deployment serving the upload route. */
	origin: string;
	signingSecret: string;
}

export const createFilesystemStorageService = (
	basePath: string,
	uploadUrls?: FilesystemUploadUrlConfig,
): StorageService => {
	const storeInternal = async (
		params: StoreParams,
	): Promise<StorageReference> => {
		const { key, content, compress = true } = params;
		const checksumSha256 = computeChecksum(content);
		const contentEncoding = compress
			? ContentEncoding.Gzip
			: ContentEncoding.None;
		const body = compress ? gzipSync(content) : content;

		const fullPath = join(basePath, key);
		await mkdir(dirname(fullPath), { recursive: true });
		await writeFile(fullPath, body);

		return {
			uri: `file://${fullPath}`,
			storageType: StorageType.Filesystem,
			storageLocation: basePath,
			storageKey: key,
			sizeBytes: body.length,
			checksumSha256,
			contentEncoding,
		};
	};

	const storeMessageBody: StorageService["storeMessageBody"] = (params) => {
		const { accountConfigId, accountId, messageId, content } = params;
		return storeInternal({
			key: buildMessageBodyKey(accountConfigId, accountId, messageId),
			content,
		});
	};

	const storeMessageBodyStream: StorageService["storeMessageBodyStream"] =
		async (params) => {
			const { accountConfigId, accountId, messageId, content } = params;
			const key = buildMessageBodyKey(accountConfigId, accountId, messageId);
			const fullPath = join(basePath, key);
			await mkdir(dirname(fullPath), { recursive: true });

			const hash = createHash("sha256");
			const hashTap = new PassThrough();
			hashTap.on("data", (chunk: Buffer) => hash.update(chunk));

			await pipeline(
				content,
				hashTap,
				createGzip(),
				createWriteStream(fullPath),
			);

			const { size } = await stat(fullPath);

			return {
				uri: `file://${fullPath}`,
				storageType: StorageType.Filesystem,
				storageLocation: basePath,
				storageKey: key,
				sizeBytes: size,
				checksumSha256: hash.digest("hex"),
				contentEncoding: ContentEncoding.Gzip,
			};
		};

	const storeBodyPart: StorageService["storeBodyPart"] = (params) => {
		const { accountConfigId, accountId, messageId, partPath, content } = params;
		return storeInternal({
			key: buildBodyPartKey(accountConfigId, accountId, messageId, partPath),
			content,
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
		const fullPath = join(basePath, key);
		return stat(fullPath)
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
		const fullPath = join(basePath, key);
		const buffer = await readFile(fullPath).catch((error: unknown) => {
			if (isStorageNotFoundError(error)) return null;
			throw error;
		});
		if (!buffer) return null;
		return buffer[0] === 0x1f && buffer[1] === 0x8b
			? gunzipSync(buffer)
			: buffer;
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
			compress: false,
		});
	};

	const extractedResultExists: StorageService["extractedResultExists"] = async (
		accountConfigId,
		accountId,
		messageId,
		partPath,
	) => {
		const textPath = join(
			basePath,
			buildExtractedTextKey(accountConfigId, accountId, messageId, partPath),
		);
		const skippedPath = join(
			basePath,
			buildExtractedSkippedKey(accountConfigId, accountId, messageId, partPath),
		);
		const exists = (fullPath: string): Promise<boolean> =>
			stat(fullPath)
				.then(() => true)
				.catch(() => false);

		const [textExists, skippedExists] = await Promise.all([
			exists(textPath),
			exists(skippedPath),
		]);
		return textExists || skippedExists;
	};

	const retrieveExtractedText: StorageService["retrieveExtractedText"] = async (
		accountConfigId,
		accountId,
		messageId,
		partPath,
	) => {
		const fullPath = join(
			basePath,
			buildExtractedTextKey(accountConfigId, accountId, messageId, partPath),
		);
		const buffer = await readFile(fullPath).catch((error: unknown) => {
			if (isStorageNotFoundError(error)) return null;
			throw error;
		});
		if (!buffer) return null;
		const decoded =
			buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer) : buffer;
		return decoded.toString("utf8");
	};

	const listExtractedTexts: StorageService["listExtractedTexts"] = async (
		accountConfigId,
		accountId,
		messageId,
	) => {
		const prefix = buildExtractedPrefix(accountConfigId, accountId, messageId);
		const suffix = ".txt.gz";
		const dirPath = join(basePath, prefix);

		const entries = await readdir(dirPath, { recursive: true }).catch(
			(error: unknown) => {
				if (isStorageNotFoundError(error)) return [];
				throw error;
			},
		);

		return entries
			.filter((entry) => entry.endsWith(suffix))
			.map((entry) => ({
				partPath: entry.slice(0, -suffix.length),
				key: `${prefix}${entry}`,
			}));
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
		return storeInternal({
			key: buildOutboxAttachmentKey(
				accountConfigId,
				accountId,
				outboxMessageId,
				outboxAttachmentId,
			),
			content,
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
		const entries = await readdir(join(basePath, prefix)).catch(
			(error: unknown) => {
				if (isStorageNotFoundError(error)) return [];
				throw error;
			},
		);

		const items: OutboxAttachmentListItem[] = [];
		for (const name of entries.slice(0, limit)) {
			const entry = parseOutboxAttachmentEntry(name);
			const { size } = await stat(join(basePath, prefix, name));
			items.push({
				outboxAttachmentId: entry.outboxAttachmentId,
				key: `${prefix}${name}`,
				sizeBytes: entry.isReservation ? entry.reservedBytes : size,
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
			const entries = await readdir(join(basePath, prefix)).catch(
				(error: unknown) => {
					if (isStorageNotFoundError(error)) return [];
					throw error;
				},
			);
			for (const name of entries) {
				if (
					parseOutboxAttachmentEntry(name).outboxAttachmentId !==
					outboxAttachmentId
				) {
					continue;
				}
				await rm(join(basePath, prefix, name), { force: true });
			}
		};

	const reserveOutboxAttachment: StorageService["reserveOutboxAttachment"] =
		async (params) => {
			await storeInternal({
				key: buildOutboxAttachmentReservationKey(
					params.accountConfigId,
					params.accountId,
					params.outboxMessageId,
					params.outboxAttachmentId,
					params.sizeBytes,
					params.expiresAt,
				),
				content: Buffer.alloc(0),
				compress: false,
			});
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
			await rm(
				join(
					basePath,
					buildOutboxAttachmentReservationKey(
						accountConfigId,
						accountId,
						outboxMessageId,
						outboxAttachmentId,
						sizeBytes,
						expiresAt,
					),
				),
				{ force: true },
			);
		};

	const statOutboxAttachment: StorageService["statOutboxAttachment"] = async (
		accountConfigId,
		accountId,
		outboxMessageId,
		outboxAttachmentId,
	) => {
		const fullPath = join(
			basePath,
			buildOutboxAttachmentKey(
				accountConfigId,
				accountId,
				outboxMessageId,
				outboxAttachmentId,
			),
		);
		const stats = await stat(fullPath).catch((error: unknown) => {
			if (isStorageNotFoundError(error)) return null;
			throw error;
		});
		return stats ? { sizeBytes: stats.size } : null;
	};

	// This backend has no presigned anything, so the URL addresses the
	// deployment's own upload route. Its authority is the same HMAC the read side
	// uses on /content, under the write label, covering the storage key, the
	// expiry and the exact byte count — a URL for one attachment, for a while,
	// for one size.
	const createOutboxAttachmentUploadUrl: StorageService["createOutboxAttachmentUploadUrl"] =
		async (params) => {
			if (!uploadUrls) {
				throw new Error(
					"the filesystem storage backend cannot mint an upload URL without an origin and a signing secret",
				);
			}
			const key = buildOutboxAttachmentKey(
				params.accountConfigId,
				params.accountId,
				params.outboxMessageId,
				params.outboxAttachmentId,
			);
			const sig = signStoragePath(
				uploadUrls.signingSecret,
				UPLOAD_URL_SIGNING_LABEL,
				key,
				[params.expiresAt, params.sizeBytes],
			);
			const origin = uploadUrls.origin.replace(/\/+$/, "");
			const query = new URLSearchParams({
				exp: String(params.expiresAt),
				max: String(params.sizeBytes),
				sig,
			});
			return {
				uploadUrl: `${origin}${UPLOAD_ROUTE_PREFIX}${key}?${query.toString()}`,
			};
		};

	const deleteOutboxAttachments: StorageService["deleteOutboxAttachments"] =
		async (accountConfigId, accountId, outboxMessageId) => {
			const dirPath = join(
				basePath,
				buildOutboxAttachmentPrefix(
					accountConfigId,
					accountId,
					outboxMessageId,
				),
			);
			await rm(dirPath, { recursive: true, force: true });
		};

	const storeDeduplicated: StorageService["storeDeduplicated"] = (params) => {
		const { accountConfigId, accountId, content } = params;
		const checksumSha256 = computeChecksum(content);
		return storeInternal({
			key: buildDeduplicatedKey(accountConfigId, accountId, checksumSha256),
			content,
		});
	};

	const storeParsedBody: StorageService["storeParsedBody"] = (params) => {
		const { accountConfigId, accountId, messageId, parsed } = params;
		const content = Buffer.from(JSON.stringify(parsed), "utf8");
		return storeInternal({
			key: buildParsedBodyKey(accountConfigId, accountId, messageId),
			content,
		});
	};

	const retrieveParsedBody: StorageService["retrieveParsedBody"] = async (
		accountConfigId,
		accountId,
		messageId,
	) => {
		const key = buildParsedBodyKey(accountConfigId, accountId, messageId);
		const fullPath = join(basePath, key);

		const buffer = await readFile(fullPath).catch((error: unknown) => {
			if (isStorageNotFoundError(error)) return null;
			throw error;
		});

		if (!buffer) return null;

		const decoded =
			buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer) : buffer;
		return JSON.parse(decoded.toString("utf8")) as ParsedBody;
	};

	// Resolve path from URI, handling both absolute and relative paths
	// Note: URIs like file://.remit/storage/... parse incorrectly - '.remit' becomes hostname
	// We reconstruct the original path by combining hostname + pathname
	const resolvePathFromUri = (uri: string): string => {
		const url = new URL(uri);
		const hostname = url.hostname;
		const pathname = url.pathname;

		// If hostname exists, it was part of a relative path (e.g., file://.remit/... -> hostname='.remit')
		if (hostname) {
			const relativePath = hostname + pathname;
			return resolve(relativePath);
		}

		// Absolute path (file:///absolute/path)
		return pathname;
	};

	const retrieve = async (uri: string): Promise<Buffer> => {
		const fullPath = resolvePathFromUri(uri);

		const buffer = await readFile(fullPath);

		if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
			return gunzipSync(buffer);
		}

		return buffer;
	};

	const exists = async (uri: string): Promise<boolean> => {
		const fullPath = resolvePathFromUri(uri);
		return stat(fullPath)
			.then(() => true)
			.catch(() => false);
	};

	const del = async (uri: string): Promise<void> => {
		const fullPath = resolvePathFromUri(uri);
		await unlink(fullPath);
	};

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
		retrieveMessageBody: async (accountConfigId, accountId, messageId) => {
			const key = buildMessageBodyKey(accountConfigId, accountId, messageId);
			const fullPath = join(basePath, key);
			const buffer = await readFile(fullPath).catch((error: unknown) => {
				if (isStorageNotFoundError(error)) return null;
				throw error;
			});
			if (!buffer) return null;
			if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
				return gunzipSync(buffer);
			}
			return buffer;
		},
		retrieveMessageBodyStream: async (
			accountConfigId,
			accountId,
			messageId,
		) => {
			const key = buildMessageBodyKey(accountConfigId, accountId, messageId);
			const fullPath = join(basePath, key);
			const buffer = await readFile(fullPath).catch((error: unknown) => {
				if (isStorageNotFoundError(error)) return null;
				throw error;
			});
			if (!buffer) return null;
			if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
				return Readable.from(buffer).pipe(createGunzip());
			}
			return Readable.from(buffer);
		},
		retrieve,
		exists,
		delete: del,
		storeExportArchiveStream: async (
			accountConfigId,
			exportRequestId,
			body,
		) => {
			const key = buildExportArchiveKey(accountConfigId, exportRequestId);
			const fullPath = join(basePath, key);
			await mkdir(dirname(fullPath), { recursive: true });
			await pipeline(body, createWriteStream(fullPath));
			return key;
		},
		getPresignedDownloadUrl: (_key: string, _expiresInSeconds: number) => {
			throw new Error(
				"getPresignedDownloadUrl is not supported on the filesystem backend",
			);
		},
	};
};
