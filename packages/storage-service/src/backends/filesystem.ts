import { ContentEncoding, StorageType } from "@remit/domain-enums";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { StorageReference, StorageService, StoreOptions } from "../storage.js";

export const createFilesystemStorageService = (basePath: string): StorageService => {
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

	const retrieve = async (uri: string): Promise<Buffer> => {
		const url = new URL(uri);
		const fullPath = url.pathname;

		const buffer = await readFile(fullPath);

		if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
			return gunzipSync(buffer);
		}

		return buffer;
	};

	const exists = async (uri: string): Promise<boolean> => {
		const url = new URL(uri);
		return stat(url.pathname)
			.then(() => true)
			.catch(() => false);
	};

	const del = async (uri: string): Promise<void> => {
		const url = new URL(uri);
		await unlink(url.pathname);
	};

	const contentAddressableKey = (content: Buffer, prefix = "dedup"): string => {
		const hash = createHash("sha256").update(content).digest("hex");
		return `${prefix}/${hash.slice(0, 2)}/${hash}`;
	};

	return { store, retrieve, exists, delete: del, contentAddressableKey };
};
