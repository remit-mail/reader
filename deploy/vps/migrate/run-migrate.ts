import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
// esbuild bundles these as text (see npm-scripts/docker-bundle.mjs's ".sql"
// loader) so the migrate step runs the exact SQL pg-schema-push.sh applies
// for local dev — one source of truth, two consumers.
import outboxTriggerSql from "../../../npm-scripts/pg-outbox-trigger.sql";
import searchIndexSql from "../../../npm-scripts/pg-search-index.sql";

/**
 * One-shot migrator for the VPS/self-host compose stack (RFC 035 D8). Runs
 * as the `migrate` service before any app container starts
 * (`condition: service_completed_successfully`) — one migrator, ordered
 * first, instead of N app containers racing to migrate on boot.
 *
 * Steps, in order:
 *   1. Extensions (vector/unaccent/pg_trgm) — pg-start.sh's dev equivalent.
 *   2. Entity schema migrations (packages/drizzle-service).
 *   3. better-auth identity schema migrations (packages/auth-service).
 *   4. The outbox NOTIFY trigger and the search full-text index objects —
 *      kept out of the drizzle schema for the same reason
 *      pg-schema-push.sh keeps them out (see the .sql files' own headers);
 *      folded in here as the last, idempotent step.
 *
 * pgvector's own table (message_embedding) is intentionally NOT created
 * here — remit-search-service/src/backends/pgvector.ts self-provisions it
 * on first use, same as it does in every other deployment of this code.
 */
const connectionString = process.env.PG_CONNECTION_URL;
if (!connectionString) {
	throw new Error("PG_CONNECTION_URL is required");
}

const pool = new pg.Pool({ connectionString });

const run = async (): Promise<void> => {
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

	console.log("[migrate] done");
};

run()
	.then(() => pool.end())
	.then(() => process.exit(0))
	.catch(async (error: unknown) => {
		console.error("[migrate] failed", error);
		await pool.end().catch(() => {});
		process.exit(1);
	});
