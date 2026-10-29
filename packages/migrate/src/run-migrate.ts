import { logger } from "@remit/logger";
import { installNodeLogger } from "@remit/logger-lambda/node";
import { BETTER_SQLITE3_LIMITS } from "../../drizzle-service/src/bound-parameters.js";
import {
	sqliteDatabasePathsFromEnv,
	syncStore,
} from "../../drizzle-service/src/databases.js";
import {
	type DisplayNameRepairClient,
	type DisplayNameRepairMode,
	formatDisplayNameReport,
	sweepDisplayNames,
} from "../../drizzle-service/src/repair/address-display-name.js";
import {
	formatJunkOnlyReport,
	type JunkOnlyRepairClient,
	type JunkOnlyRepairMode,
	sweepJunkOnlyAddresses,
} from "../../drizzle-service/src/repair/junk-only-address.js";
import {
	formatStrandedSentReport,
	type StrandedSentRepairClient,
	type StrandedSentRepairMode,
	sweepStrandedSentOutbox,
} from "../../drizzle-service/src/repair/stranded-sent-outbox.js";
import type { MailboxSpecialUseRepo } from "../../drizzle-service/src/repos/i4-mailbox-special-use.js";
import { SearchIndex } from "../../drizzle-service/src/search/thread-message-search.js";
import { createSqliteRepositories } from "../../drizzle-service/src/sqlite-repositories.js";
import {
	type LegacySplitOutcome,
	legacyDatabasePath,
	PRE_SPLIT_SUFFIX,
	type SqliteDriver,
	splitLegacyDatabase,
} from "./legacy-split.js";
import { applyMigrationSets } from "./migration-sets.js";

// The drizzle-service modules above are reached by module path rather than
// through the package entry point: this entrypoint is bundled by esbuild, and
// everything reached this way is pure TypeScript over the drizzle query builder,
// so bundling it drags in no native driver — better-sqlite3 stays external and
// dynamically imported below.

installNodeLogger();

/**
 * One-shot migrator for the VPS/self-host compose stack (RFC 035 D8). Runs
 * as the `migrate` service before any app container starts
 * (`condition: service_completed_successfully`) — one migrator, ordered
 * first, instead of N app containers racing to migrate on boot.
 *
 * SQLite is the only backend this stack deploys, so `DATA_BACKEND` is checked
 * rather than dispatched on: it applies each database's migration set — app,
 * tenant mail and tenant search (#1420) — against its local file and installs
 * the idempotent DDL objects around them.
 */

/**
 * This migrator applies generated schema migrations, installs the idempotent
 * DDL objects around them, and rewrites row content in three places.
 *
 * The rule behind that clause still holds: when a column's MEANING changes,
 * rows written under the old meaning are stale rather than convertible, and the
 * remedy is `remit purge` followed by a re-sync — the mail is on the server,
 * and re-fetching it is cheaper to operate and to reason about than a bespoke
 * one-shot rewrite that every future install carries forever. The exceptions
 * are state a re-sync cannot repair, and the image is the only artefact an
 * update delivers (#281), so they live here.
 *
 * The first is a display name that claims to be somebody else's address
 * (#826). An attacker chose that string, and the spoofing messages are still on
 * the server, so a re-sync plants the names again. It runs from Node because
 * the decision has to be the same function the guard uses. It removes the
 * address and keeps the rest of the name.
 *
 * The second is an outbox row stranded at `sent` (#824): mail the user has
 * lost sight of that is on no server folder to re-fetch. It flips a status and
 * writes the reason, on rows an hour past any retry, and touches nothing else.
 *
 * The third marks an address seen only on mail in Junk, so it is not offered
 * as a sender to trust.
 */

/**
 * `--check` is the read-only mode of this same entrypoint (D17): it reports what
 * the repair would do and applies nothing at all, migrations included, so it can
 * be pointed at a live instance. `--rebuild-search` runs the full migration and
 * then rebuilds the search index from the mail database, the recovery for an
 * index that has drifted. `--split-from <path>` names the old single database
 * file when it is not `remit.db` beside app.db; the split from it (#1420)
 * otherwise runs unasked, once. Anything else is refused rather than ignored —
 * a mistyped flag that silently ran the full migration is the failure mode this
 * guards.
 */
type Mode =
	| { kind: "migrate" }
	| { kind: "check" }
	| { kind: "rebuild-search" }
	| { kind: "split"; source: string };

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
		return { kind: "migrate" };
	}
	if (argv.length === 1 && argv[0] === "--check") {
		return { kind: "check" };
	}
	if (argv.length === 1 && argv[0] === "--rebuild-search") {
		return { kind: "rebuild-search" };
	}
	if (argv.length === 2 && argv[0] === "--split-from" && argv[1]) {
		return { kind: "split", source: argv[1] };
	}
	throw new Error(
		`unrecognised argument: ${argv.join(" ")} — the options are --check, --rebuild-search and --split-from <path>`,
	);
};

/**
 * The scan is a full pass over three tables and runs on every boot. It reads
 * only the names SQL can narrow to an address shape, and the steady state after
 * one repair is that none of them needs rewriting — a read, never a write lock.
 */
const displayNameStep = async (
	client: DisplayNameRepairClient,
	mode: DisplayNameRepairMode,
	search?: SearchIndex,
): Promise<void> => {
	const report = await sweepDisplayNames(client, mode);
	for (const line of formatDisplayNameReport(report)) {
		logStep({ step: "display-name-repair" }, line);
	}
	// The sender text is in the search index too; a rewritten thread row is
	// written there again so a search no longer finds the claim.
	await search?.sync(
		report.sites
			.filter((site) => site.table === "thread_message")
			.flatMap((site) => site.rewrittenIds),
	);
};

/**
 * A count, and a write only for the populations the count found rows in. The
 * steady state on a healthy instance is zero stranded rows, so this is a read on
 * every boot but the first one after the fix ships.
 */
const strandedSentStep = async (
	client: StrandedSentRepairClient,
	mode: StrandedSentRepairMode,
): Promise<void> => {
	const report = await sweepStrandedSentOutbox(client, mode);
	for (const line of formatStrandedSentReport(report)) {
		logStep({ step: "stranded-sent-repair" }, line);
	}
};

/**
 * Which folder holds Junk is decided once, in TypeScript, through the same
 * repository seam every other special-folder lookup reads — so the sweep
 * honours a folder-role appointment and cannot disagree with the sync that
 * harvested the address. The predicate below only compares mailbox ids.
 */
const junkOnlyAddressStep = async (
	client: JunkOnlyRepairClient,
	specialUse: MailboxSpecialUseRepo,
	mode: JunkOnlyRepairMode,
): Promise<void> => {
	const roles = await specialUse.resolveJunkRolesForInstance();
	const report = await sweepJunkOnlyAddresses(client, mode, roles);
	for (const line of formatJunkOnlyReport(report)) {
		logStep({ step: "junk-only-address-repair" }, line);
	}
};

type ParamRepairClient = DisplayNameRepairClient &
	StrandedSentRepairClient &
	JunkOnlyRepairClient;

const reportLegacySplit = (
	source: string,
	outcome: LegacySplitOutcome,
): void => {
	if (outcome.kind === "superseded") {
		logger.warn(
			{ source },
			"the old single database file was left in place: app.db already holds data",
		);
		return;
	}
	if (outcome.kind !== "split") return;
	logStep(
		{ copied: outcome.copied, kept: `${source}${PRE_SPLIT_SUFFIX}` },
		"split the single database file",
	);
	if (Object.keys(outcome.dropped).length > 0) {
		logger.warn(
			{ dropped: outcome.dropped },
			"dropped flag changes and moves not yet pushed to the mail server; the resync takes the server state",
		);
	}
};

const runSqlite = async (mode: Mode): Promise<void> => {
	const paths = sqliteDatabasePathsFromEnv();

	// Dynamic imports so the module stays bundleable with the native
	// better-sqlite3 binding marked external (see npm-scripts/docker-bundle.mjs).
	const { default: Database } = await import("better-sqlite3");
	const { drizzle: sqliteDrizzle } = await import("drizzle-orm/better-sqlite3");
	const driver: SqliteDriver = { Database, drizzle: sqliteDrizzle };

	// Before any of the three files is opened: opening app.db creates it, and
	// an app.db with data in it is what says the split already happened.
	if (mode.kind !== "check") {
		const source =
			mode.kind === "split" ? mode.source : legacyDatabasePath(paths);
		const outcome = await splitLegacyDatabase(
			source,
			paths,
			driver,
			".",
			(database) =>
				logStep({ database }, "applying schema migrations (sqlite)"),
		);
		if (mode.kind === "split" && outcome.kind === "absent") {
			throw new Error(`--split-from: ${source} does not exist`);
		}
		if (mode.kind === "split" && outcome.kind === "superseded") {
			throw new Error(
				`--split-from: ${paths.app} already holds data, so ${source} was not split into it`,
			);
		}
		reportLegacySplit(source, outcome);
	}

	// `--check` opens the files read-only, so "writes nothing" is enforced by
	// the engine rather than by reading the queries — that is what makes it safe
	// to point at a live instance.
	const readonly = mode.kind === "check";
	const open = (path: string) => {
		const sqlite = new Database(path, { readonly });
		if (!readonly) {
			// WAL + busy_timeout are the cross-process write coordination RFC 036
			// D3 requires; set them on the migrator connection too so a concurrent
			// app boot never trips on a fresh database file.
			sqlite.pragma("journal_mode = WAL");
			sqlite.pragma("busy_timeout = 5000");
			sqlite.pragma("foreign_keys = ON");
		}
		return sqlite;
	};
	const appSqlite = open(paths.app);
	const mailSqlite = open(paths.mail);
	const searchSqlite = open(paths.search);
	// One handle, both parameterised repairs: the two clients are the same
	// three lines, and a second copy is a second thing to keep in step.
	const paramRepairClient: ParamRepairClient = {
		all: async (sql, params) => mailSqlite.prepare(sql).all(...params),
		run: async (sql, params) => mailSqlite.prepare(sql).run(...params).changes,
	};
	const app = sqliteDrizzle(appSqlite);
	const db = sqliteDrizzle(mailSqlite);
	const searchDb = sqliteDrizzle(searchSqlite);
	const search = new SearchIndex(
		db,
		syncStore(searchDb, BETTER_SQLITE3_LIMITS),
	);
	const specialUse = createSqliteRepositories(
		{
			app,
			mail: db,
			search: searchDb,
		},
		BETTER_SQLITE3_LIMITS,
		{
			storage: {
				deleteKeys: () =>
					Promise.reject(
						new Error("the migrator deletes no mail, so it holds no storage"),
					),
			},
		},
	).mailboxSpecialUse;
	try {
		if (mode.kind === "check") {
			await displayNameStep(paramRepairClient, "check");
			await strandedSentStep(paramRepairClient, "check");
			await junkOnlyAddressStep(paramRepairClient, specialUse, "check");
			return;
		}

		await applyMigrationSets(
			{ app, mail: db, search: searchDb },
			".",
			(database) =>
				logStep({ database }, "applying schema migrations (sqlite)"),
		);

		await displayNameStep(paramRepairClient, "repair", search);

		await strandedSentStep(paramRepairClient, "repair");

		await junkOnlyAddressStep(paramRepairClient, specialUse, "repair");

		// The search index is written after each mail write and never with it,
		// so it only needs building here when it cannot have followed: a count
		// that disagrees with the mail database's (a new or deleted search
		// database, a write that died between the two), or an operator asking
		// for it.
		if (mode.kind === "rebuild-search" || (await search.needsRebuild())) {
			logStep({}, "rebuilding the search index from the mail database");
			const indexed = await search.rebuild();
			logStep({ indexed }, "search index rebuilt");
		}
	} finally {
		appSqlite.close();
		mailSqlite.close();
		searchSqlite.close();
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
	logStep({ mode: mode.kind }, "migrate done");
};

run()
	.then(() => process.exit(0))
	.catch((error: unknown) => {
		logger.error({ error }, "migrate failed");
		process.exit(1);
	});
