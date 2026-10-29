import { readdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { isStorageNotFoundError } from "@remit/storage-service";
import type { AccountObjectStore } from "./context.js";

export const filesystemAccountObjects = (root: string): AccountObjectStore => ({
	list: async (prefix) => {
		const entries = await readdir(join(root, prefix), {
			recursive: true,
			withFileTypes: true,
		}).catch((error: unknown) => {
			if (isStorageNotFoundError(error)) return [];
			throw error;
		});
		return {
			keys: entries
				.filter((entry) => entry.isFile())
				.map((entry) => relative(root, join(entry.parentPath, entry.name))),
			nextContinuationToken: undefined,
		};
	},
	delete: async (keys) => {
		for (const key of keys) await rm(join(root, key), { force: true });
	},
});
