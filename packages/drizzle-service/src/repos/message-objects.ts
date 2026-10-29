import {
	createMockStorageService,
	messageObjectPrefixOf,
	type StorageService,
} from "@remit/storage-service";
import pMap from "p-map";
import type { RepositoryDb } from "../db.js";
import { messageTable } from "../schema/message-data.js";
import { inList } from "./in-list.js";

export const DEFAULT_MESSAGE_OBJECT_DELETE_CONCURRENCY = 8;

export interface MessageObjectStore {
	storage: Pick<StorageService, "deletePrefix">;
	messageObjectDeleteConcurrency: number;
}

export const messageObjectsInMemory = (): MessageObjectStore => ({
	storage: createMockStorageService(),
	messageObjectDeleteConcurrency: 1,
});

export interface RemovedMessageRow {
	messageId: string;
	bodyStorageKey: string | null;
}

interface Candidate {
	prefix: string;
	bodyStorageKey: string;
}

const candidatesOf = (row: RemovedMessageRow): Candidate[] => {
	const { messageId, bodyStorageKey } = row;
	if (bodyStorageKey === null) return [];
	const ownerPrefix = messageObjectPrefixOf(bodyStorageKey);
	const ownPrefix = ownerPrefix.replace(/[^/]+\/$/, `${messageId}/`);
	const owner = { prefix: ownerPrefix, bodyStorageKey };
	if (ownPrefix === ownerPrefix) return [owner];
	const at = bodyStorageKey.lastIndexOf(ownerPrefix);
	const ownBodyStorageKey = `${bodyStorageKey.slice(0, at)}${ownPrefix}${bodyStorageKey.slice(at + ownerPrefix.length)}`;
	return [owner, { prefix: ownPrefix, bodyStorageKey: ownBodyStorageKey }];
};

export class MessageObjects {
	constructor(
		private readonly db: Pick<RepositoryDb<Record<string, unknown>>, "select">,
		private readonly store: MessageObjectStore,
	) {}

	async reclaim(removed: readonly RemovedMessageRow[]): Promise<void> {
		const candidates = new Map(
			removed.flatMap(candidatesOf).map((c) => [c.prefix, c]),
		);
		if (candidates.size === 0) return;
		const keys = [
			...new Set([...candidates.values()].map((c) => c.bodyStorageKey)),
		];
		const referenced = await this.db
			.select({ bodyStorageKey: messageTable.bodyStorageKey })
			.from(messageTable)
			.where(inList(messageTable.bodyStorageKey, keys));
		const stillReferenced = new Set(
			referenced.flatMap((row) =>
				row.bodyStorageKey === null ? [] : [row.bodyStorageKey],
			),
		);
		await pMap(
			[...candidates.values()].filter(
				(c) => !stillReferenced.has(c.bodyStorageKey),
			),
			(c) => this.store.storage.deletePrefix(c.prefix),
			{ concurrency: this.store.messageObjectDeleteConcurrency },
		);
	}
}
