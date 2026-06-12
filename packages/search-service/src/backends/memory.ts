import type {
	VectorMatch,
	VectorQuery,
	VectorQueryFilter,
	VectorRecord,
} from "../types.js";

export interface VectorStoreService {
	upsert(vectors: VectorRecord[]): Promise<void>;
	query(params: VectorQuery): Promise<VectorMatch[]>;
	delete(filter: { messageId: string }): Promise<void>;
	deleteKeys(keys: string[]): Promise<void>;
}

const cosineSimilarity = (a: number[], b: number[]): number => {
	if (a.length !== b.length) {
		throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
	}
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	if (normA === 0 || normB === 0) return 0;
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

const matchesFilter = (
	record: VectorRecord,
	filter: VectorQueryFilter | undefined,
): boolean => {
	if (!filter) return true;
	const m = record.metadata;
	if (
		filter.accountConfigId !== undefined &&
		m.accountConfigId !== filter.accountConfigId
	) {
		return false;
	}
	if (
		filter.mailboxId !== undefined &&
		!m.mailboxIds.includes(filter.mailboxId)
	) {
		return false;
	}
	if (filter.chunkType !== undefined && m.chunkType !== filter.chunkType) {
		return false;
	}
	if (
		filter.hasAttachment !== undefined &&
		m.hasAttachment !== filter.hasAttachment
	) {
		return false;
	}
	if (filter.hasStars !== undefined && m.hasStars !== filter.hasStars) {
		return false;
	}
	if (filter.isRead !== undefined && m.isRead !== filter.isRead) {
		return false;
	}
	if (filter.sentDateRange) {
		const { from, to } = filter.sentDateRange;
		if (from !== undefined && m.sentDate < from) return false;
		if (to !== undefined && m.sentDate > to) return false;
	}
	return true;
};

export class MemoryVectorStore implements VectorStoreService {
	private store = new Map<string, VectorRecord>();

	upsert = async (vectors: VectorRecord[]): Promise<void> => {
		for (const v of vectors) {
			this.store.set(v.chunkId, v);
		}
	};

	query = async (params: VectorQuery): Promise<VectorMatch[]> => {
		const matches: VectorMatch[] = [];
		for (const record of this.store.values()) {
			if (!matchesFilter(record, params.filter)) continue;
			const score = cosineSimilarity(params.vector, record.vector);
			matches.push({
				chunkId: record.chunkId,
				score,
				metadata: record.metadata,
			});
		}
		matches.sort((a, b) => b.score - a.score);
		return matches.slice(0, params.topK);
	};

	delete = async (filter: { messageId: string }): Promise<void> => {
		const toDelete: string[] = [];
		for (const [id, record] of this.store.entries()) {
			if (record.metadata.messageId === filter.messageId) {
				toDelete.push(id);
			}
		}
		for (const id of toDelete) {
			this.store.delete(id);
		}
	};

	deleteKeys = async (keys: string[]): Promise<void> => {
		for (const key of keys) {
			this.store.delete(key);
		}
	};

	size = (): number => this.store.size;
}

export const createMemoryVectorStore = (): MemoryVectorStore =>
	new MemoryVectorStore();
