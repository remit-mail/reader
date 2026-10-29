import {
	createMockStorageService,
	messageObjectKeysOf,
	type StorageService,
} from "@remit/storage-service";
import type { RepositoryDb } from "../db.js";
import { messageTable } from "../schema/message-data.js";
import { inList } from "./in-list.js";

export interface MessageObjectStore {
	storage: Pick<StorageService, "deleteKeys">;
}

export const messageObjectsInMemory = (): MessageObjectStore => ({
	storage: createMockStorageService(),
});

export interface RemovedMessageRow {
	messageId: string;
	bodyStorageKey: string | null;
}

export interface RemovedBodyPartRow {
	messageId: string;
	partPath: string;
}

export class MessageObjects {
	constructor(
		private readonly db: Pick<RepositoryDb<Record<string, unknown>>, "select">,
		private readonly store: MessageObjectStore,
	) {}

	async reclaim(
		removed: readonly RemovedMessageRow[],
		removedParts: readonly RemovedBodyPartRow[],
	): Promise<void> {
		const partPathsOf = new Map<string, string[]>();
		for (const { messageId, partPath } of removedParts) {
			partPathsOf.set(messageId, [
				...(partPathsOf.get(messageId) ?? []),
				partPath,
			]);
		}
		const own: string[] = [];
		const sharedBy = new Map<string, string[]>();
		for (const { messageId, bodyStorageKey } of removed) {
			if (bodyStorageKey === null) continue;
			const keys = messageObjectKeysOf(
				bodyStorageKey,
				messageId,
				partPathsOf.get(messageId) ?? [],
			);
			own.push(...keys.own);
			sharedBy.set(bodyStorageKey, keys.shared);
		}
		if (sharedBy.size === 0) return;
		const referenced = await this.db
			.select({ bodyStorageKey: messageTable.bodyStorageKey })
			.from(messageTable)
			.where(inList(messageTable.bodyStorageKey, [...sharedBy.keys()]));
		for (const { bodyStorageKey } of referenced) {
			if (bodyStorageKey !== null) sharedBy.delete(bodyStorageKey);
		}
		await this.store.storage.deleteKeys([
			...own,
			...[...sharedBy.values()].flat(),
		]);
	}
}
