import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
	mkdir,
	readdir,
	readFile,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip, gunzipSync, gzipSync } from "node:zlib";
import { ContentEncoding, StorageType } from "@remit/domain-enums";
import type {
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
	buildParsedBodyKey,
	computeChecksum,
	isStorageNotFoundError,
} from "../storage.js";

interface StoreParams {
	key: string;
	content: Buffer;
	compress?: boolean;
}

export const createFilesystemStorageService = (
	basePath: string,
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
