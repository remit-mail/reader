import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type SqliteDatabase from "better-sqlite3";
import {
	type IndexedChunkProvenance,
	type IndexProvenance,
	summarizeIndexProvenance,
} from "../index-report.js";
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
	default: new (path: string, options?: SqliteDatabase.Options) => Database;
};

type SqliteVecModule = {
	load: (db: Database) => void;
};

// `SQLITE_VEC_EXTENSION_PATH` overrides the npm `sqlite-vec` package's
// getLoadablePath() with a pre-built loadable extension. That package resolves a
// glibc-only prebuilt (`sqlite-vec-<platform>/vec0.so`) which cannot dlopen on
// the Alpine/musl backend image, so that image bakes a musl-compiled `vec0.so`
// and points this at it. better-sqlite3 derives the entry point from the
// filename, and the `vec0` basename resolves to `sqlite3_vec_init` (SQLite drops
// the digit). Unset keeps the npm resolution — the glibc search-index-worker
// image sets nothing and loads the package unchanged.
const loadSqliteVec = async (db: Database): Promise<void> => {
	const overridePath = process.env.SQLITE_VEC_EXTENSION_PATH;
	if (overridePath) {
		db.loadExtension(overridePath);
		return;
	}
	const sqliteVec = await runtimeImport<SqliteVecModule>("sqlite-vec");
	sqliteVec.load(db);
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

/**
 * Count the stored index by the embedder that wrote each vector (#455), read
 * straight off the vec0 table rather than through the store: a report is not a
 * search, and the caller has no query to run.
 *
 * Reads only. `fileMustExist` keeps a report on a box that has never indexed
 * anything from creating the vector database as a side effect of asking about
 * it, and an absent vec0 table — the window between the first boot and the
 * first upsert — is an empty index rather than an error. The connection is not
 * opened read-only: these files are WAL, and a read-only connection cannot
 * initialize the shared-memory index when no writer is attached.
 *
 * The rows are streamed into the summary. One row per chunk means several per
 * message, and a full mailbox's worth of metadata JSON must not be materialized
 * to be counted.
 */
export const readSqliteIndexProvenance = async (config: {
	path: string;
	configuredEmbeddingId: string;
}): Promise<IndexProvenance> => {
	if (!existsSync(config.path)) {
		return summarizeIndexProvenance(config.configuredEmbeddingId, []);
	}
	const { default: Database } =
		await runtimeImport<BetterSqlite3Module>("better-sqlite3");
	const db = new Database(config.path, { fileMustExist: true });
	try {
		await loadSqliteVec(db);
		const table = db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vec_chunks'",
			)
			.get();
		if (!table) {
			return summarizeIndexProvenance(config.configuredEmbeddingId, []);
		}
		const rows = db
			.prepare("SELECT message_id AS messageId, meta FROM vec_chunks")
			.iterate() as IterableIterator<{ messageId: string; meta: string }>;
		return summarizeIndexProvenance(
			config.configuredEmbeddingId,
			provenanceOf(rows),
		);
	} finally {
		db.close();
	}
};

function* provenanceOf(
	rows: Iterable<{ messageId: string; meta: string }>,
): Generator<IndexedChunkProvenance> {
	for (const row of rows) {
		const metadata = JSON.parse(row.meta) as ChunkMetadata;
		yield { messageId: row.messageId, embeddingId: metadata.embeddingId };
	}
}

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
			if (config.path !== ":memory:") {
				mkdirSync(dirname(config.path), { recursive: true });
			}
			const db = new Database(config.path);
			db.pragma("journal_mode = WAL");
			await loadSqliteVec(db);
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
					// vec0 filterable metadata columns are strict NOT NULL; a chunk
					// with no category binds an empty-string sentinel (a `category = ?`
					// filter never matches it) rather than NULL, which vec0 rejects.
					// The returned metadata reads from the `meta` JSON column, so
					// category stays correctly absent there.
					m.category ?? "",
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
