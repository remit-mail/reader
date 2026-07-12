import type { Pool, PoolClient } from "pg";
import type {
	ChunkMetadata,
	VectorMatch,
	VectorQuery,
	VectorQueryFilter,
	VectorRecord,
} from "../types.js";
import type { VectorStoreService } from "./memory.js";
import { runtimeImport } from "./runtime-import.js";

type PgModule = {
	default: { Pool: new (config: { connectionString: string }) => Pool };
};

/**
 * pgvector-backed vector store for the Postgres-parity stack. Vectors live in
 * the same Postgres as their message rows (one row per chunk), so there is no
 * write amplification and scoped queries are plain SQL WHERE clauses combined
 * with the ANN ordering — the equality/range filters run in the same query as
 * the KNN instead of post-filtering a fixed top-k (which silently drops recall).
 *
 * `mailboxId` is a single-value scalar because the indexing pipeline always
 * writes a one-element `mailboxIds`; membership reduces to equality — same as
 * the sqlite-vec backend.
 *
 * The store self-provisions its table and indexes on first use (the `vector`
 * extension must already be enabled on the database — the local pg container
 * does this at startup). This mirrors the sqlite-vec backend, which owns its
 * own CREATE, and keeps the embedding table out of the drizzle schema that the
 * extension-less embedded-postgres test harness pushes.
 */
const DEFAULT_DIMENSIONS = 384;
const DEFAULT_TABLE = "message_embedding";

const createTableSql = (table: string, dimensions: number): string => `
	CREATE TABLE IF NOT EXISTS ${table} (
		chunk_id TEXT PRIMARY KEY,
		message_id TEXT NOT NULL,
		account_config_id TEXT NOT NULL,
		mailbox_id TEXT NOT NULL,
		chunk_type TEXT NOT NULL,
		sent_date BIGINT NOT NULL,
		is_read BOOLEAN NOT NULL,
		has_attachment BOOLEAN NOT NULL,
		has_stars BOOLEAN NOT NULL,
		embedding VECTOR(${dimensions}) NOT NULL,
		metadata JSONB NOT NULL
	);
`;

const createIndexesSql = (table: string): string[] => [
	`CREATE INDEX IF NOT EXISTS ${table}_message_id_idx ON ${table} (message_id);`,
	`CREATE INDEX IF NOT EXISTS ${table}_account_config_id_idx ON ${table} (account_config_id);`,
	`CREATE INDEX IF NOT EXISTS ${table}_embedding_hnsw_idx ON ${table} USING hnsw (embedding vector_cosine_ops);`,
];

const toVectorLiteral = (vector: number[]): string => `[${vector.join(",")}]`;

// pgvector renders a `vector` column as `[1,2,3]`; parse it back to a number[]
// for the anchor pooling read path (getByMessage).
const parseVectorLiteral = (literal: string): number[] => {
	const inner = literal.trim().replace(/^\[/, "").replace(/\]$/, "");
	if (inner.length === 0) return [];
	return inner.split(",").map((n) => Number(n));
};

interface WhereClause {
	sql: string;
	params: unknown[];
}

const buildFilterClause = (
	filter: VectorQueryFilter | undefined,
	nextParamIndex: number,
): WhereClause => {
	const conditions: string[] = [];
	const params: unknown[] = [];
	let i = nextParamIndex;
	if (!filter) return { sql: "", params };

	if (filter.accountConfigId !== undefined) {
		conditions.push(`account_config_id = $${i++}`);
		params.push(filter.accountConfigId);
	}
	if (filter.mailboxId !== undefined) {
		conditions.push(`mailbox_id = $${i++}`);
		params.push(filter.mailboxId);
	}
	if (filter.chunkType !== undefined) {
		conditions.push(`chunk_type = $${i++}`);
		params.push(filter.chunkType);
	}
	if (filter.category !== undefined) {
		conditions.push(`metadata->>'category' = $${i++}`);
		params.push(filter.category);
	}
	if (filter.hasAttachment !== undefined) {
		conditions.push(`has_attachment = $${i++}`);
		params.push(filter.hasAttachment);
	}
	if (filter.hasStars !== undefined) {
		conditions.push(`has_stars = $${i++}`);
		params.push(filter.hasStars);
	}
	if (filter.isRead !== undefined) {
		conditions.push(`is_read = $${i++}`);
		params.push(filter.isRead);
	}
	if (filter.sentDateRange?.from !== undefined) {
		conditions.push(`sent_date >= $${i++}`);
		params.push(Math.trunc(filter.sentDateRange.from));
	}
	if (filter.sentDateRange?.to !== undefined) {
		conditions.push(`sent_date <= $${i++}`);
		params.push(Math.trunc(filter.sentDateRange.to));
	}

	return {
		sql: conditions.length > 0 ? ` AND ${conditions.join(" AND ")}` : "",
		params,
	};
};

export interface PgVectorStoreConfig {
	connectionString: string;
	dimensions?: number;
	tableName?: string;
}

export const createPgVectorStore = (
	config: PgVectorStoreConfig,
): VectorStoreService => {
	const dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
	const table = config.tableName ?? DEFAULT_TABLE;
	let poolPromise: Promise<Pool> | null = null;

	const getPool = async (): Promise<Pool> => {
		if (poolPromise) return poolPromise;
		poolPromise = (async () => {
			const pg = await runtimeImport<PgModule>("pg");
			const pool = new pg.default.Pool({
				connectionString: config.connectionString,
			});
			await pool.query(createTableSql(table, dimensions));
			for (const sql of createIndexesSql(table)) {
				await pool.query(sql);
			}
			return pool;
		})();
		return poolPromise;
	};

	const upsert = async (vectors: VectorRecord[]): Promise<void> => {
		if (vectors.length === 0) return;
		const pool = await getPool();
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			for (const record of vectors) {
				const m = record.metadata;
				await client.query(
					`
					INSERT INTO ${table} (
						chunk_id, message_id, account_config_id, mailbox_id, chunk_type,
						sent_date, is_read, has_attachment, has_stars, embedding, metadata
					) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector, $11::jsonb)
					ON CONFLICT (chunk_id) DO UPDATE SET
						message_id = EXCLUDED.message_id,
						account_config_id = EXCLUDED.account_config_id,
						mailbox_id = EXCLUDED.mailbox_id,
						chunk_type = EXCLUDED.chunk_type,
						sent_date = EXCLUDED.sent_date,
						is_read = EXCLUDED.is_read,
						has_attachment = EXCLUDED.has_attachment,
						has_stars = EXCLUDED.has_stars,
						embedding = EXCLUDED.embedding,
						metadata = EXCLUDED.metadata
					`,
					[
						record.chunkId,
						m.messageId,
						m.accountConfigId,
						m.mailboxIds[0] ?? "",
						m.chunkType,
						Math.trunc(m.sentDate),
						m.isRead,
						m.hasAttachment,
						m.hasStars,
						toVectorLiteral(record.vector),
						JSON.stringify(m),
					],
				);
			}
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	};

	const query = async (params: VectorQuery): Promise<VectorMatch[]> => {
		const pool = await getPool();
		const vectorLiteral = toVectorLiteral(params.vector);
		const { sql: filterSql, params: filterParams } = buildFilterClause(
			params.filter,
			3,
		);
		// Iterative index scan keeps a selective metadata filter from under-filling
		// the top-k: pgvector re-scans the HNSW graph until topK matches pass the
		// WHERE instead of stopping at the first ef_search candidates.
		const client: PoolClient = await pool.connect();
		try {
			await client.query("BEGIN");
			await client.query("SET LOCAL hnsw.iterative_scan = relaxed_order");
			const result = await client.query<{
				chunk_id: string;
				score: number;
				metadata: ChunkMetadata;
			}>(
				`
				SELECT chunk_id, metadata, 1 - (embedding <=> $1::vector) AS score
				FROM ${table}
				WHERE TRUE${filterSql}
				ORDER BY embedding <=> $1::vector
				LIMIT $2
				`,
				[vectorLiteral, params.topK, ...filterParams],
			);
			await client.query("COMMIT");
			return result.rows.map((row) => ({
				chunkId: row.chunk_id,
				score: Number(row.score),
				metadata: row.metadata,
			}));
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	};

	const existingContentHashes = async (
		chunkIds: string[],
	): Promise<Map<string, string>> => {
		const out = new Map<string, string>();
		if (chunkIds.length === 0) return out;
		const pool = await getPool();
		const result = await pool.query<{
			chunk_id: string;
			content_hash: string | null;
		}>(
			`SELECT chunk_id, metadata->>'contentHash' AS content_hash
			 FROM ${table} WHERE chunk_id = ANY($1::text[])`,
			[chunkIds],
		);
		for (const row of result.rows) {
			if (row.content_hash !== null) out.set(row.chunk_id, row.content_hash);
		}
		return out;
	};

	const getByMessage = async (messageId: string): Promise<VectorRecord[]> => {
		const pool = await getPool();
		const result = await pool.query<{
			chunk_id: string;
			embedding: string;
			metadata: ChunkMetadata;
		}>(
			`SELECT chunk_id, embedding::text AS embedding, metadata
			 FROM ${table} WHERE message_id = $1`,
			[messageId],
		);
		return result.rows.map((row) => ({
			chunkId: row.chunk_id,
			vector: parseVectorLiteral(row.embedding),
			metadata: row.metadata,
		}));
	};

	const del = async (filter: { messageId: string }): Promise<void> => {
		const pool = await getPool();
		await pool.query(`DELETE FROM ${table} WHERE message_id = $1`, [
			filter.messageId,
		]);
	};

	const close = async (): Promise<void> => {
		if (!poolPromise) return;
		const pool = await poolPromise;
		poolPromise = null;
		await pool.end();
	};

	return {
		upsert,
		query,
		existingContentHashes,
		getByMessage,
		delete: del,
		close,
	};
};
