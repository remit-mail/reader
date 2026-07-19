import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
// esbuild bundles these as text (see npm-scripts/docker-bundle.mjs's ".sql"
// loader) so the migrate step runs the exact SQL pg-schema-push.sh applies
// for local dev — one source of truth, two consumers.
import outboxTriggerSql from "../../../npm-scripts/pg-outbox-trigger.sql";
import searchIndexSql from "../../../npm-scripts/pg-search-index.sql";
import sqliteSearchIndexSql from "../../../npm-scripts/sqlite-search-index.sql";

/**
 * One-shot migrator for the VPS/self-host compose stack (RFC 035 D8). Runs
 * as the `migrate` service before any app container starts
 * (`condition: service_completed_successfully`) — one migrator, ordered
 * first, instead of N app containers racing to migrate on boot.
 *
 * It branches on `DATA_BACKEND` (RFC 036 D5): the Postgres path applies the
 * pg migration sets and installs the extensions + NOTIFY trigger + search
 * index; the SQLite path applies the sqlite migration sets against the local
 * database file. Both share the same structure — extensions/DDL steps that do
 * not exist on SQLite are simply skipped.
 *
 * pgvector's own table (message_embedding) is intentionally NOT created here —
 * remit-search-service self-provisions it on first use, and the sqlite-vec
 * store owns its own file the same way; neither is this migrator's concern.
 */

/**
 * One-shot data migrations, keyed by name in `remit_data_migration`.
 *
 * Distinct from the drizzle sets above, which describe the shape of the data,
 * not its content. A step lands here when a column's MEANING changes and the
 * rows already written under the old meaning would be misread under the new
 * one.
 */
const DATA_MIGRATION_TABLE_SQL = `CREATE TABLE IF NOT EXISTS remit_data_migration (
	name TEXT PRIMARY KEY,
	applied_at BIGINT NOT NULL
)`;

/**
 * `mailbox.highest_modseq` used to be a copy of the server's live
 * HIGHESTMODSEQ, rewritten by every mailbox-list sweep. It is now message
 * sync's own cursor: how far CHANGEDSINCE has been applied for that mailbox.
 *
 * Every row written by an older build therefore claims the server's current
 * position, which under the new meaning says "everything is already applied".
 * Left alone, an upgraded stack would go straight to incremental fetching,
 * abandon any backfill in progress, and never see a message below the value.
 *
 * Resetting to "0" says "nothing applied yet", which is the truthful answer
 * for a cursor that was never maintained. It costs one enumeration round per
 * mailbox — the UID watermarks are untouched, so nothing is re-fetched — and
 * message sync reseeds the cursor once a round completes cleanly.
 */
const RESET_MAILBOX_CURSOR = "reset_mailbox_highest_modseq_to_unseeded";

const runPostgres = async (): Promise<void> => {
	const connectionString = process.env.PG_CONNECTION_URL;
	if (!connectionString) {
		throw new Error("PG_CONNECTION_URL is required");
	}

	const pool = new pg.Pool({ connectionString });
	try {
		console.log("[migrate] enabling extensions: vector, unaccent, pg_trgm");
		await pool.query("CREATE EXTENSION IF NOT EXISTS vector;");
		await pool.query("CREATE EXTENSION IF NOT EXISTS unaccent;");
		await pool.query("CREATE EXTENSION IF NOT EXISTS pg_trgm;");

		console.log("[migrate] applying entity schema migrations");
		await migrate(drizzle(pool), {
			migrationsFolder: "migrations/entities",
			migrationsTable: "__drizzle_migrations_entities",
		});

		console.log("[migrate] applying auth schema migrations");
		await migrate(drizzle(pool), {
			migrationsFolder: "migrations/auth",
			migrationsTable: "__drizzle_migrations_auth",
		});

		console.log("[migrate] installing outbox notify trigger");
		await pool.query(outboxTriggerSql);

		console.log("[migrate] installing search index objects");
		await pool.query(searchIndexSql);

		await pool.query(DATA_MIGRATION_TABLE_SQL);
		const applied = await pool.query(
			"SELECT 1 FROM remit_data_migration WHERE name = $1",
			[RESET_MAILBOX_CURSOR],
		);
		if (applied.rowCount === 0) {
			console.log(`[migrate] data migration: ${RESET_MAILBOX_CURSOR}`);
			const client = await pool.connect();
			try {
				await client.query("BEGIN");
				await client.query("UPDATE mailbox SET highest_modseq = '0'");
				await client.query(
					"INSERT INTO remit_data_migration (name, applied_at) VALUES ($1, $2)",
					[RESET_MAILBOX_CURSOR, Date.now()],
				);
				await client.query("COMMIT");
			} catch (error) {
				await client.query("ROLLBACK");
				throw error;
			} finally {
				client.release();
			}
		}
	} finally {
		await pool.end();
	}
};

const runSqlite = async (): Promise<void> => {
	const dbPath = process.env.SQLITE_DB_PATH;
	if (!dbPath) {
		throw new Error("SQLITE_DB_PATH is required when DATA_BACKEND=sqlite");
	}

	// Dynamic imports so the Postgres path never loads the native better-sqlite3
	// binding, and the module stays bundleable with better-sqlite3 marked
	// external (see npm-scripts/docker-bundle.mjs).
	const { default: Database } = await import("better-sqlite3");
	const { drizzle: sqliteDrizzle } = await import("drizzle-orm/better-sqlite3");
	const { migrate: sqliteMigrate } = await import(
		"drizzle-orm/better-sqlite3/migrator"
	);

	const sqlite = new Database(dbPath);
	try {
		// WAL + busy_timeout are the cross-process write coordination RFC 036 D3
		// requires; set them on the migrator connection too so a concurrent app
		// boot never trips on a fresh database file.
		sqlite.pragma("journal_mode = WAL");
		sqlite.pragma("busy_timeout = 5000");
		sqlite.pragma("foreign_keys = ON");

		const db = sqliteDrizzle(sqlite);

		console.log("[migrate] applying entity schema migrations (sqlite)");
		sqliteMigrate(db, {
			migrationsFolder: "migrations-sqlite/entities",
			migrationsTable: "__drizzle_migrations_entities",
		});

		console.log("[migrate] applying auth schema migrations (sqlite)");
		sqliteMigrate(db, {
			migrationsFolder: "migrations-sqlite/auth",
			migrationsTable: "__drizzle_migrations_auth",
		});

		// The external-content FTS5 trigram table + its thread_message
		// maintenance triggers, the final idempotent step (RFC 036 D4) — the
		// sqlite counterpart of pg-search-index.sql. The triggers keep the index
		// in sync on every write from here on; a database that already had thread
		// rows before this table existed (an upgrade from the wave-1 folded-LIKE
		// build) needs a one-time backfill, since the triggers only see writes
		// that happen after they exist.
		//
		// Install and backfill run in one transaction so a crash between them can
		// never leave the table existing but empty (which would make every later
		// run skip the backfill and search silently miss the pre-existing rows).
		// The backfill is gated on the table being newly created — the steady
		// state where the triggers already keep it in sync must not re-insert
		// every row. An external-content index cannot be scanned bare (its
		// computed `sender` has no content-table column), so the guard, not a
		// NOT-IN diff, is what keeps this from double-indexing.
		console.log("[migrate] installing FTS5 search index objects (sqlite)");
		const installSearchIndex = sqlite.transaction(() => {
			const ftsExisted = sqlite
				.prepare(
					"SELECT 1 FROM sqlite_master WHERE type='table' AND name='thread_message_fts'",
				)
				.get();
			sqlite.exec(sqliteSearchIndexSql);
			if (!ftsExisted) {
				console.log("[migrate] backfilling FTS5 index from existing threads");
				sqlite.exec(
					`INSERT INTO thread_message_fts(rowid, subject, sender)
					 SELECT rowid, coalesce(subject, ''),
					        coalesce(from_name, '') || ' ' || coalesce(from_email, '')
					 FROM thread_message`,
				);
			}
		});
		installSearchIndex();

		sqlite.exec(DATA_MIGRATION_TABLE_SQL);
		const alreadyApplied = sqlite
			.prepare("SELECT 1 FROM remit_data_migration WHERE name = ?")
			.get(RESET_MAILBOX_CURSOR);
		if (!alreadyApplied) {
			console.log(`[migrate] data migration: ${RESET_MAILBOX_CURSOR}`);
			const resetCursor = sqlite.transaction(() => {
				sqlite.exec("UPDATE mailbox SET highest_modseq = '0'");
				sqlite
					.prepare(
						"INSERT INTO remit_data_migration (name, applied_at) VALUES (?, ?)",
					)
					.run(RESET_MAILBOX_CURSOR, Date.now());
			});
			resetCursor();
		}
	} finally {
		sqlite.close();
	}
};

const run = async (): Promise<void> => {
	if (process.env.DATA_BACKEND === "sqlite") {
		await runSqlite();
	} else {
		await runPostgres();
	}
	console.log("[migrate] done");
};

run()
	.then(() => process.exit(0))
	.catch((error: unknown) => {
		console.error("[migrate] failed", error);
		process.exit(1);
	});
