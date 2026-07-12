import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type SqliteDatabase from "better-sqlite3";
import type {
	ChunkMetadata,
	VectorMatch,
	VectorQuery,
	VectorQueryFilter,
	VectorRecord,
} from "../types.js";
import type { VectorStoreService } from "./memory.js";
import { runtimeImport } from "./runtime-import.js";

type Database = SqliteDatabase.Database;

type BetterSqlite3Module = {
	default: new (path: string) => Database;
};

type SqliteVecModule = {
	load: (db: Database) => void;
};

/**
 * vec0 stores each chunk's vector alongside the scalar fields the query path
 * filters on, so equality / range filters are pushed into the KNN instead of
 * post-filtering a fixed top-k (which would silently drop recall). The full
 * metadata object rides along in an auxiliary (`+`) column for reconstruction.
 *
 * `mailboxId` is a single-value scalar here because the indexing pipeline always
 * writes a one-element `mailboxIds`; membership therefore reduces to equality on
 * the stored value.
 */
const CREATE_TABLE = (dimensions: number): string => `
	CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
		chunk_id TEXT PRIMARY KEY,
		message_id TEXT,
		account_config_id TEXT,
		mailbox_id TEXT,
		chunk_type TEXT,
		category TEXT,
		sent_date INTEGER,
		is_read INTEGER,
		has_attachment INTEGER,
		has_stars INTEGER,
		embedding FLOAT[${dimensions}] distance_metric=cosine,
		+meta TEXT
	);
`;

// vec0 INTEGER metadata columns are strict and better-sqlite3 binds a plain JS
// number as REAL, so every integer value bound against an INTEGER column (the
// booleans and sent_date) must be a BigInt to avoid an "Expected integer" error.
const bool = (value: boolean): bigint => (value ? 1n : 0n);

type BindValue = string | number | bigint;

interface WhereClause {
	sql: string;
	params: BindValue[];
}

const buildFilterClause = (
	filter: VectorQueryFilter | undefined,
): WhereClause => {
	const sql: string[] = [];
	const params: BindValue[] = [];
	if (!filter) return { sql: "", params };

	if (filter.accountConfigId !== undefined) {
		sql.push("account_config_id = ?");
		params.push(filter.accountConfigId);
	}
	if (filter.mailboxId !== undefined) {
		sql.push("mailbox_id = ?");
		params.push(filter.mailboxId);
	}
	if (filter.chunkType !== undefined) {
		sql.push("chunk_type = ?");
		params.push(filter.chunkType);
	}
	if (filter.category !== undefined) {
		sql.push("category = ?");
		params.push(filter.category);
	}
	if (filter.hasAttachment !== undefined) {
		sql.push("has_attachment = ?");
		params.push(bool(filter.hasAttachment));
	}
	if (filter.hasStars !== undefined) {
		sql.push("has_stars = ?");
		params.push(bool(filter.hasStars));
	}
	if (filter.isRead !== undefined) {
		sql.push("is_read = ?");
		params.push(bool(filter.isRead));
	}
	if (filter.sentDateRange) {
		if (filter.sentDateRange.from !== undefined) {
			sql.push("sent_date >= ?");
			params.push(BigInt(Math.trunc(filter.sentDateRange.from)));
		}
		if (filter.sentDateRange.to !== undefined) {
			sql.push("sent_date <= ?");
			params.push(BigInt(Math.trunc(filter.sentDateRange.to)));
		}
	}

	return { sql: sql.length > 0 ? ` AND ${sql.join(" AND ")}` : "", params };
};

export interface SqliteVectorStoreConfig {
	path: string;
	dimensions?: number;
}

const DEFAULT_DIMENSIONS = 384;

export const createSqliteVectorStore = (
	config: SqliteVectorStoreConfig,
): VectorStoreService => {
	const dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
	let dbPromise: Promise<Database> | null = null;

	const getDb = async (): Promise<Database> => {
		if (dbPromise) return dbPromise;
		dbPromise = (async () => {
			const { default: Database } =
				await runtimeImport<BetterSqlite3Module>("better-sqlite3");
			const sqliteVec = await runtimeImport<SqliteVecModule>("sqlite-vec");
			if (config.path !== ":memory:") {
				mkdirSync(dirname(config.path), { recursive: true });
			}
			const db = new Database(config.path);
			db.pragma("journal_mode = WAL");
			sqliteVec.load(db);
			db.exec(CREATE_TABLE(dimensions));
			return db;
		})();
		return dbPromise;
	};

	const upsert = async (vectors: VectorRecord[]): Promise<void> => {
		if (vectors.length === 0) return;
		const db = await getDb();
		const del = db.prepare("DELETE FROM vec_chunks WHERE chunk_id = ?");
		const ins = db.prepare(`
			INSERT INTO vec_chunks (
				chunk_id, message_id, account_config_id, mailbox_id, chunk_type,
				category, sent_date, is_read, has_attachment, has_stars, embedding, meta
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		const writeAll = db.transaction((records: VectorRecord[]) => {
			for (const r of records) {
				const m = r.metadata;
				del.run(r.chunkId);
				ins.run(
					r.chunkId,
					m.messageId,
					m.accountConfigId,
					m.mailboxIds[0] ?? "",
					m.chunkType,
					m.category ?? null,
					BigInt(Math.trunc(m.sentDate)),
					bool(m.isRead),
					bool(m.hasAttachment),
					bool(m.hasStars),
					JSON.stringify(r.vector),
					JSON.stringify(m),
				);
			}
		});
		writeAll(vectors);
	};

	const query = async (params: VectorQuery): Promise<VectorMatch[]> => {
		const db = await getDb();
		const { sql: filterSql, params: filterParams } = buildFilterClause(
			params.filter,
		);
		const stmt = db.prepare(`
			SELECT chunk_id AS chunkId, distance, meta
			FROM vec_chunks
			WHERE embedding MATCH ? AND k = ?${filterSql}
			ORDER BY distance
		`);
		const rows = stmt.all(
			JSON.stringify(params.vector),
			params.topK,
			...filterParams,
		) as { chunkId: string; distance: number; meta: string }[];
		return rows.map((row) => ({
			chunkId: row.chunkId,
			score: 1 - row.distance,
			metadata: JSON.parse(row.meta) as ChunkMetadata,
		}));
	};

	const existingContentHashes = async (
		chunkIds: string[],
	): Promise<Map<string, string>> => {
		const out = new Map<string, string>();
		if (chunkIds.length === 0) return out;
		const db = await getDb();
		const placeholders = chunkIds.map(() => "?").join(", ");
		const stmt = db.prepare(
			`SELECT chunk_id AS chunkId, meta FROM vec_chunks WHERE chunk_id IN (${placeholders})`,
		);
		const rows = stmt.all(...chunkIds) as { chunkId: string; meta: string }[];
		for (const row of rows) {
			const meta = JSON.parse(row.meta) as ChunkMetadata;
			if (typeof meta.contentHash === "string") {
				out.set(row.chunkId, meta.contentHash);
			}
		}
		return out;
	};

	const getByMessage = async (messageId: string): Promise<VectorRecord[]> => {
		const db = await getDb();
		const stmt = db.prepare(
			`SELECT chunk_id AS chunkId, vec_to_json(embedding) AS embedding, meta
			 FROM vec_chunks WHERE message_id = ?`,
		);
		const rows = stmt.all(messageId) as {
			chunkId: string;
			embedding: string;
			meta: string;
		}[];
		return rows.map((row) => ({
			chunkId: row.chunkId,
			vector: JSON.parse(row.embedding) as number[],
			metadata: JSON.parse(row.meta) as ChunkMetadata,
		}));
	};

	const del = async (filter: { messageId: string }): Promise<void> => {
		const db = await getDb();
		db.prepare("DELETE FROM vec_chunks WHERE message_id = ?").run(
			filter.messageId,
		);
	};

	return { upsert, query, existingContentHashes, getByMessage, delete: del };
};
