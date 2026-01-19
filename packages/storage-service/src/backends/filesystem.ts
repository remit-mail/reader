import { createHash } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { ContentEncoding, StorageType } from "@remit/domain-enums";
import type {
	StorageReference,
	StorageService,
	StoreOptions,
} from "../storage.js";

export const createFilesystemStorageService = (
	basePath: string,
): StorageService => {
	const store = async (
		content: Buffer,
		options: StoreOptions,
	): Promise<StorageReference> => {
		const { key, contentEncoding = ContentEncoding.None } = options;

		const checksumSha256 = createHash("sha256").update(content).digest("hex");
		const finalKey = options.contentAddressable
			? `dedup/${checksumSha256.slice(0, 2)}/${checksumSha256}`
			: key;

		const fullPath = join(basePath, finalKey);
		const body =
			contentEncoding === ContentEncoding.Gzip ? gzipSync(content) : content;

		await mkdir(dirname(fullPath), { recursive: true });
		await writeFile(fullPath, body);

		return {
			uri: `file://${fullPath}`,
			storageType: StorageType.Filesystem,
			storageLocation: basePath,
			storageKey: finalKey,
			sizeBytes: body.length,
			checksumSha256,
			contentEncoding,
		};
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

	const contentAddressableKey = (content: Buffer, prefix = "dedup"): string => {
		const hash = createHash("sha256").update(content).digest("hex");
		return `${prefix}/${hash.slice(0, 2)}/${hash}`;
	};

	return { store, retrieve, exists, delete: del, contentAddressableKey };
};
