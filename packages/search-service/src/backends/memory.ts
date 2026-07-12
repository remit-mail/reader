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
	/**
	 * Read the stored content hash for each of the given deterministic chunk keys.
	 * Keys with no stored vector, or a vector with no contentHash, are absent from
	 * the map. Addresses vectors by key only — never an index-wide scan.
	 */
	existingContentHashes(chunkIds: string[]): Promise<Map<string, string>>;
	/**
	 * Read every stored chunk vector (data + metadata) for a message, addressed by
	 * the message's deterministic chunk keys — never an index-wide scan. Empty when
	 * the message has no indexed chunks. Backs the filter-anchor build (RFC 034
	 * Decision 2.1), which pools a message's chunk vectors into a single anchor.
	 */
	getByMessage(messageId: string): Promise<VectorRecord[]>;
	/**
	 * Release any held connections (e.g. a pooled database client). Optional — the
	 * in-memory and file backends hold nothing; the pgvector backend closes its
	 * pool so a short-lived process (a test, a one-shot reindex) can exit cleanly.
	 */
	close?(): Promise<void>;
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
	if (filter.category !== undefined && m.category !== filter.category) {
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

	existingContentHashes = async (
		chunkIds: string[],
	): Promise<Map<string, string>> => {
		const out = new Map<string, string>();
		for (const chunkId of chunkIds) {
			const hash = this.store.get(chunkId)?.metadata.contentHash;
			if (typeof hash === "string") out.set(chunkId, hash);
		}
		return out;
	};

	getByMessage = async (messageId: string): Promise<VectorRecord[]> => {
		const out: VectorRecord[] = [];
		for (const record of this.store.values()) {
			if (record.metadata.messageId === messageId) out.push(record);
		}
		return out;
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

	size = (): number => this.store.size;
}

export const createMemoryVectorStore = (): MemoryVectorStore =>
	new MemoryVectorStore();
