import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
// esbuild bundles these as text (see npm-scripts/docker-bundle.mjs's ".sql"
// loader) so the migrate step runs the exact SQL pg-schema-push.sh applies
// for local dev — one source of truth, two consumers.
import outboxTriggerSql from "../../../npm-scripts/pg-outbox-trigger.sql";
import searchIndexSql from "../../../npm-scripts/pg-search-index.sql";
import sqliteSearchIndexSql from "../../../npm-scripts/sqlite-search-index.sql";
// Reached by relative path for the same reason the .sql files above are: this
// entrypoint is bundled by esbuild, not resolved as a workspace dependency, and
// the repair module imports nothing so bundling it drags in no schema or driver.
import {
	type CategoryDivergenceReport,
	checkThreadMessageCategory,
	formatCheckReport,
	formatRepairResult,
	formatRepairSkipped,
	type RepairSqlClient,
	readResidual,
	repairThreadMessageCategory,
} from "../../../packages/drizzle-service/src/repair/thread-message-category.js";

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
 * This migrator applies generated schema migrations, installs the idempotent
 * DDL objects around them, and rewrites row content in exactly one place.
 *
 * That last clause is an amendment (#321, D16). This file used to state that it
 * never rewrites row content, and the rule behind it still holds: when a
 * column's MEANING changes, rows written under the old meaning are stale rather
 * than convertible, and the remedy is `remit purge` followed by a re-sync — the
 * mail is on the server, and re-fetching it is cheaper to operate and to reason
 * about than a bespoke one-shot rewrite that every future install carries
 * forever.
 *
 * The exception is `thread_message.category`, and the reason is delivery. It is
 * a denormalized copy of `message.category` that nothing has ever read, so its
 * write path was never load-bearing and the column drifted; #304 turns it into
 * the SQL predicate behind the inbox category filter. The correction therefore
 * has to be on every existing instance before that read path goes live, and the
 * image is the only artefact an update delivers: `remit update` moves an image
 * tag and runs `compose pull` against the compose file already on disk, so a
 * compose-level step reaches nobody who is already installed (#281). This
 * entrypoint is in the image, six services gate on it, and `check_migrate()`
 * enforces it again — so the repair lives here. A doc comment does not outrank
 * the repair running.
 *
 * The repair is bounded to a value that is a primary-key probe away in the same
 * database: it copies `message.category` onto rows that disagree with it, and
 * nothing else. It is not a precedent for converting rows whose meaning changed.
 */

/**
 * `--check` is the read-only mode of this same entrypoint (D17): it reports what
 * the repair would do and applies nothing at all, migrations included, so it can
 * be pointed at a live instance. Anything else is refused rather than ignored —
 * a mistyped flag that silently ran the full migration is the failure mode this
 * guards.
 */
type Mode = "migrate" | "check";

const parseMode = (argv: readonly string[]): Mode => {
	if (argv.length === 0) {
		return "migrate";
	}
	if (argv.length === 1 && argv[0] === "--check") {
		return "check";
	}
	throw new Error(
		`unrecognised argument: ${argv.join(" ")} — the only option is --check`,
	);
};

const logReport = (report: CategoryDivergenceReport): void => {
	for (const line of formatCheckReport(report)) {
		console.log(`[migrate:category-check] ${line}`);
	}
};

/**
 * Report first, then repair only if the report found something to write, then
 * re-read the residual. The before-numbers are the evidence an upgrade leaves
 * behind, the skip is what keeps a steady-state boot from taking SQLite's write
 * lock, and the re-read is what distinguishes "nothing to do" from "did not run"
 * — a repair that never ran logs no `[migrate:category-repair]` line at all.
 */
const repairThreadMessageCategoryStep = async (
	client: RepairSqlClient,
): Promise<void> => {
	const report = await checkThreadMessageCategory(client);
	logReport(report);

	const log = (lines: readonly string[]): void => {
		for (const line of lines) {
			console.log(`[migrate:category-repair] ${line}`);
		}
	};

	if (report.repairable === 0) {
		log(formatRepairSkipped(report));
		return;
	}

	const result = await repairThreadMessageCategory(client);
	log(formatRepairResult(result, await readResidual(client)));
};

/**
 * `migrations/entities` and `migrations/auth` are the Postgres set the
 * Dockerfile's builder stage stages conditionally (RFC 036 D5) — the
 * open-core export ships only `migrations-sqlite`, so a backend image built
 * from this tree never has the Postgres set to COPY. Checking for it here,
 * before opening a connection, is what turns that into an explicit "unsupported"
 * message instead of a migrator that connects, starts applying migrations, and
 * dies partway when `migrationsFolder` resolves to nothing (reader#176).
 */
const requirePostgresMigrations = (): void => {
	const missing = ["migrations/entities", "migrations/auth"].filter(
		(folder) => !existsSync(folder),
	);
	if (missing.length === 0) {
		return;
	}

	throw new Error(
		`Postgres self-host is not supported in this build: ${missing.join(", ")} ${
			missing.length > 1 ? "are" : "is"
		} not shipped here. Use the SQLite backend instead ` +
			"(DATA_BACKEND=sqlite, deploy/vps/docker-compose.sqlite.yml) — see README.md.",
	);
};

const postgresRepairClient = (pool: pg.Pool): RepairSqlClient => ({
	dialect: "postgres",
	all: async (sql) => (await pool.query(sql)).rows,
	run: async (sql) => (await pool.query(sql)).rowCount ?? 0,
});

const runPostgres = async (mode: Mode): Promise<void> => {
	if (mode === "migrate") {
		requirePostgresMigrations();
	}

	const connectionString = process.env.PG_CONNECTION_URL;
	if (!connectionString) {
		throw new Error("PG_CONNECTION_URL is required");
	}

	// `--check` gets a session the server itself refuses writes on, the counterpart
	// of the SQLite path's read-only open: "writes nothing" is then a property of
	// the connection rather than a claim about the queries.
	const pool = new pg.Pool({
		connectionString,
		...(mode === "check"
			? { options: "-c default_transaction_read_only=on" }
			: {}),
	});
	const repairClient = postgresRepairClient(pool);
	try {
		if (mode === "check") {
			logReport(await checkThreadMessageCategory(repairClient));
			return;
		}

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

		console.log("[migrate] applying instance-owner schema migrations");
		await migrate(drizzle(pool), {
			migrationsFolder: "migrations/meta",
			migrationsTable: "__drizzle_migrations_meta",
		});

		// Same position as on the SQLite path: after the generated migrations that
		// supply the column and the filter's index, before the idempotent DDL step.
		await repairThreadMessageCategoryStep(repairClient);

		console.log("[migrate] installing outbox notify trigger");
		await pool.query(outboxTriggerSql);

		console.log("[migrate] installing search index objects");
		await pool.query(searchIndexSql);
	} finally {
		await pool.end();
	}
};

const runSqlite = async (mode: Mode): Promise<void> => {
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

	// `--check` opens the file read-only, so "writes nothing" is enforced by the
	// engine rather than by reading the queries — that is what makes it safe to
	// point at a live instance.
	const sqlite = new Database(dbPath, { readonly: mode === "check" });
	const sqliteRepairClient: RepairSqlClient = {
		dialect: "sqlite",
		all: async (sql) => sqlite.prepare(sql).all(),
		run: async (sql) => sqlite.prepare(sql).run().changes,
	};
	try {
		if (mode === "check") {
			logReport(await checkThreadMessageCategory(sqliteRepairClient));
			return;
		}

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

		console.log("[migrate] applying instance-owner schema migrations (sqlite)");
		sqliteMigrate(db, {
			migrationsFolder: "migrations-sqlite/meta",
			migrationsTable: "__drizzle_migrations_meta",
		});

		// After the generated migrations, which is where the column and the
		// filter's index come from, and before the FTS transaction: the repair
		// does not depend on either index and must not be inside a transaction
		// that also builds one. Its own UPDATE touches only `category`, and the
		// FTS trigger fires on `subject`/`from_name`/`from_email` only, so the
		// repair re-tokenizes nothing.
		await repairThreadMessageCategoryStep(sqliteRepairClient);

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
	} finally {
		sqlite.close();
	}
};

const run = async (): Promise<void> => {
	const mode = parseMode(process.argv.slice(2));
	if (process.env.DATA_BACKEND === "sqlite") {
		await runSqlite(mode);
	} else {
		await runPostgres(mode);
	}
	console.log(`[migrate] done (${mode})`);
};

run()
	.then(() => process.exit(0))
	.catch((error: unknown) => {
		console.error("[migrate] failed", error);
		process.exit(1);
	});
