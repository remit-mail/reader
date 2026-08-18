// esbuild bundles this as text (see npm-scripts/docker-bundle.mjs's ".sql"
// loader) so the migrate step runs the exact SQL the test harness applies —
// one source of truth, two consumers.
import sqliteSearchIndexSql from "../../../npm-scripts/sqlite-search-index.sql";
import {
	type DisplayNameRepairClient,
	type DisplayNameRepairMode,
	formatDisplayNameReport,
	sweepDisplayNames,
} from "../../drizzle-service/src/repair/address-display-name.js";
import {
	type CategoryDivergenceReport,
	checkThreadMessageCategory,
	formatCheckReport,
	formatRepairResult,
	formatRepairSkipped,
	type RepairSqlClient,
	readResidual,
	repairThreadMessageCategory,
} from "../../drizzle-service/src/repair/thread-message-category.js";
// Reached by module path rather than through either package's entry point: this
// entrypoint is bundled by esbuild, and the repair modules import nothing but a
// pure predicate, so bundling them drags in no schema or driver.
import { logger } from "../../logger-lambda/src/logger.js";

/**
 * One-shot migrator for the VPS/self-host compose stack (RFC 035 D8). Runs
 * as the `migrate` service before any app container starts
 * (`condition: service_completed_successfully`) — one migrator, ordered
 * first, instead of N app containers racing to migrate on boot.
 *
 * SQLite is the only backend this stack deploys, so `DATA_BACKEND` is checked
 * rather than dispatched on: it applies the sqlite migration sets against the
 * local database file and installs the idempotent DDL objects around them.
 *
 * The sqlite-vec store's own file is intentionally NOT created here — the
 * search service owns it and provisions it on first use.
 */

/**
 * This migrator applies generated schema migrations, installs the idempotent
 * DDL objects around them, and rewrites row content in two places.
 *
 * That last clause is an amendment (#321, D16). This file used to state that it
 * never rewrites row content, and the rule behind it still holds: when a
 * column's MEANING changes, rows written under the old meaning are stale rather
 * than convertible, and the remedy is `remit purge` followed by a re-sync — the
 * mail is on the server, and re-fetching it is cheaper to operate and to reason
 * about than a bespoke one-shot rewrite that every future install carries
 * forever.
 *
 * The first exception is `thread_message.category`, and the reason is delivery. It is
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
 *
 * The second is a display name that claims to be somebody else's address (#826).
 * Nothing here converts a meaning: an attacker chose that string, it was stored
 * verbatim, and on 2026-08-18 it took private mail to a stranger. Purge and
 * re-sync is no remedy — the spoofing messages are still on the server, so a
 * re-sync plants the names again — and the guard that now refuses them only
 * covers what is harvested next. It runs from Node rather than as a SQL
 * migration because the decision has to be the same function the guard uses;
 * see the repair module for what a SQL twin of it destroys.
 */

/**
 * `--check` is the read-only mode of this same entrypoint (D17): it reports what
 * the repair would do and applies nothing at all, migrations included, so it can
 * be pointed at a live instance. Anything else is refused rather than ignored —
 * a mistyped flag that silently ran the full migration is the failure mode this
 * guards.
 */
type Mode = "migrate" | "check";

// A schema change applied to someone's database is an audit-grade signal, and
// this one-shot's output is the only record that it ran and what it did — it
// must not sit below the default threshold. One wrapper so the exception is one
// decision rather than one per step.
const logStep = (fields: Record<string, unknown>, msg: string): void => {
	// biome-ignore lint/plugin/no-logger-info: a migration step is an audit-grade signal
	logger.info(fields, msg);
};

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
		logStep({ step: "category-check" }, line);
	}
};

/**
 * Report first, then repair only if the report found something to write, then
 * re-read the residual. The before-numbers are the evidence an upgrade leaves
 * behind, the skip is what keeps a steady-state boot from taking SQLite's write
 * lock, and the re-read is what distinguishes "nothing to do" from "did not run"
 * — a repair that never ran logs no `step: "category-repair"` line at all.
 */
const repairThreadMessageCategoryStep = async (
	client: RepairSqlClient,
): Promise<void> => {
	const report = await checkThreadMessageCategory(client);
	logReport(report);

	const log = (lines: readonly string[]): void => {
		for (const line of lines) {
			logStep({ step: "category-repair" }, line);
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
 * The scan is a full pass over three tables and runs on every boot. It reads
 * only the names SQL can narrow to an address shape, and the steady state after
 * one repair is that none of them decides true — a read, never a write lock.
 */
const displayNameStep = async (
	client: DisplayNameRepairClient,
	mode: DisplayNameRepairMode,
): Promise<void> => {
	const report = await sweepDisplayNames(client, mode);
	for (const line of formatDisplayNameReport(report)) {
		logStep({ step: "display-name-repair" }, line);
	}
};

const runSqlite = async (mode: Mode): Promise<void> => {
	const dbPath = process.env.SQLITE_DB_PATH;
	if (!dbPath) {
		throw new Error("SQLITE_DB_PATH is required when DATA_BACKEND=sqlite");
	}

	// Dynamic imports so the module stays bundleable with the native
	// better-sqlite3 binding marked external (see npm-scripts/docker-bundle.mjs).
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
		all: async (sql) => sqlite.prepare(sql).all(),
		run: async (sql) => sqlite.prepare(sql).run().changes,
	};
	const displayNameClient: DisplayNameRepairClient = {
		all: async (sql, params) => sqlite.prepare(sql).all(...params),
		run: async (sql, params) => sqlite.prepare(sql).run(...params).changes,
	};
	try {
		if (mode === "check") {
			logReport(await checkThreadMessageCategory(sqliteRepairClient));
			await displayNameStep(displayNameClient, "check");
			return;
		}

		// WAL + busy_timeout are the cross-process write coordination RFC 036 D3
		// requires; set them on the migrator connection too so a concurrent app
		// boot never trips on a fresh database file.
		sqlite.pragma("journal_mode = WAL");
		sqlite.pragma("busy_timeout = 5000");
		sqlite.pragma("foreign_keys = ON");

		const db = sqliteDrizzle(sqlite);

		logStep({}, "applying entity schema migrations (sqlite)");
		sqliteMigrate(db, {
			migrationsFolder: "migrations-sqlite/entities",
			migrationsTable: "__drizzle_migrations_entities",
		});

		logStep({}, "applying auth schema migrations (sqlite)");
		sqliteMigrate(db, {
			migrationsFolder: "migrations-sqlite/auth",
			migrationsTable: "__drizzle_migrations_auth",
		});

		logStep({}, "applying instance-owner schema migrations (sqlite)");
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

		// Before the FTS transaction for the same reason, and because it does write
		// `thread_message.from_name`: the AFTER UPDATE trigger re-tokenizes those
		// rows where the index already exists, and where it does not, the backfill
		// below reads the repaired names.
		await displayNameStep(displayNameClient, "repair");

		// The external-content FTS5 trigram table + its thread_message
		// maintenance triggers, the final idempotent step (RFC 036 D4). The
		// triggers keep the index
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
		logStep({}, "installing FTS5 search index objects (sqlite)");
		const installSearchIndex = sqlite.transaction(() => {
			const ftsExisted = sqlite
				.prepare(
					"SELECT 1 FROM sqlite_master WHERE type='table' AND name='thread_message_fts'",
				)
				.get();
			sqlite.exec(sqliteSearchIndexSql);
			if (!ftsExisted) {
				logStep({}, "backfilling FTS5 index from existing threads");
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

// The stack this migrator belongs to is SQLite (deploy/vps/docker-compose.sqlite.yml
// pins `DATA_BACKEND: sqlite`), and it is the only backend the migration sets in
// the image cover. Any other value is a misconfiguration, refused here before a
// connection is opened rather than part-way through applying migrations.
const run = async (): Promise<void> => {
	const mode = parseMode(process.argv.slice(2));
	const backend = process.env.DATA_BACKEND;
	if (backend !== "sqlite") {
		throw new Error(
			`DATA_BACKEND=${backend ?? "(unset)"} is not supported: this stack runs ` +
				"SQLite. Set DATA_BACKEND=sqlite — see deploy/vps/docker-compose.sqlite.yml.",
		);
	}
	await runSqlite(mode);
	logStep({ mode }, "migrate done");
};

run()
	.then(() => process.exit(0))
	.catch((error: unknown) => {
		logger.error({ error }, "migrate failed");
		process.exit(1);
	});
