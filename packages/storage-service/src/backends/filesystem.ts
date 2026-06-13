import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, gunzipSync, gzipSync } from "node:zlib";
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
		storeDeduplicated,
		storeParsedBody,
		retrieveParsedBody,
		retrieve,
		exists,
		delete: del,
	};
};
