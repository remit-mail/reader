import { openSqlite } from "@remit/drizzle-service/sqlite";
import { logger } from "@remit/logger";
import { installNodeLogger } from "@remit/logger-lambda/node";
import { NODE_SQLITE_LIMITS } from "../../drizzle-service/src/bound-parameters.js";
import {
	sqliteDatabasePathsFromEnv,
	syncStore,
} from "../../drizzle-service/src/databases.js";
import {
	type DisplayNameRepairMode,
	formatDisplayNameReport,
	sweepDisplayNames,
} from "../../drizzle-service/src/repair/address-display-name.js";
import type { SqliteRepairClient } from "../../drizzle-service/src/repair/client.js";
import {
	type FilterFromDomainRepairMode,
	formatFilterFromDomainReport,
	repairFilterFromDomain,
} from "../../drizzle-service/src/repair/filter-from-domain.js";
import {
	formatJunkOnlyReport,
	type JunkOnlyRepairMode,
	sweepJunkOnlyAddresses,
} from "../../drizzle-service/src/repair/junk-only-address.js";
import {
	formatStrandedSentReport,
	type StrandedSentRepairMode,
	sweepStrandedSentOutbox,
} from "../../drizzle-service/src/repair/stranded-sent-outbox.js";
import type { MailboxSpecialUseRepo } from "../../drizzle-service/src/repos/i4-mailbox-special-use.js";
import { SearchIndex } from "../../drizzle-service/src/search/thread-message-search.js";
import { createSqliteRepositories } from "../../drizzle-service/src/sqlite-repositories.js";
import { migrateSqliteFiles } from "./in-place.js";

// The drizzle-service modules above are reached by module path or the `sqlite`
// subpath rather than through the package entry point: this entrypoint is
// bundled by esbuild, and the native driver behind the opener stays external
// (see npm-scripts/docker-bundle.mjs).

installNodeLogger();

/**
 * One-shot migrator for the VPS/self-host compose stack (RFC 035 D8). Runs
 * as the `migrate` service before any app container starts
 * (`condition: service_completed_successfully`) — one migrator, ordered
 * first, instead of N app containers racing to migrate on boot.
 *
 * SQLite is the only backend this stack deploys, so `DATA_BACKEND` is checked
 * rather than dispatched on: it applies each database's migration set — app,
 * tenant mail and tenant search (#1420) — against the file each is configured
 * on, and brings a v0.9 remit.db forward in place first (see in-place.ts).
 */

/**
 * This migrator applies generated schema migrations, installs the idempotent
 * DDL objects around them, and rewrites row content in four places.
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
 *
 * The fourth narrows a filter whose subdomain FromDomain value was compiled to
 * its registrable domain back to the exact host. The rule is the user's own
 * config, which no re-sync restores.
 */

/**
 * `--check` is the read-only mode of this same entrypoint (D17): it reports what
 * the repair would do and applies nothing at all, migrations included, so it can
 * be pointed at a live instance. `--rebuild-search` runs the full migration and
 * then rebuilds the search index from the mail database, the recovery for an
 * index that has drifted. Anything else is refused rather than ignored — a
 * mistyped flag that silently ran the full migration is the failure mode this
 * guards.
 */
type Mode =
	| { kind: "migrate" }
	| { kind: "check" }
	| { kind: "rebuild-search" };

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
	throw new Error(
		`unrecognised argument: ${argv.join(" ")} — the options are --check and --rebuild-search`,
	);
};

/**
 * The scan is a full pass over three tables and runs on every boot. It reads
 * only the names SQL can narrow to an address shape, and the steady state after
 * one repair is that none of them needs rewriting — a read, never a write lock.
 */
const displayNameStep = async (
	client: SqliteRepairClient,
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
	client: SqliteRepairClient,
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
	client: SqliteRepairClient,
	specialUse: MailboxSpecialUseRepo,
	mode: JunkOnlyRepairMode,
): Promise<void> => {
	const roles = await specialUse.resolveJunkRolesForInstance();
	const report = await sweepJunkOnlyAddresses(client, mode, roles);
	for (const line of formatJunkOnlyReport(report)) {
		logStep({ step: "junk-only-address-repair" }, line);
	}
};

const filterFromDomainStep = async (
	client: SqliteRepairClient,
	mode: FilterFromDomainRepairMode,
): Promise<void> => {
	const report = await repairFilterFromDomain(client, mode);
	for (const line of formatFilterFromDomainReport(report)) {
		logStep({ step: "filter-from-domain-repair" }, line);
	}
};

const runSqlite = async (mode: Mode): Promise<void> => {
	const paths = sqliteDatabasePathsFromEnv();

	// The schema first, with its own handles, so the repairs below run against
	// a file that is fully migrated and, for a v0.9 remit.db, verified.
	if (mode.kind !== "check") {
		migrateSqliteFiles(paths, ".", logStep);
	}

	// `--check` opens the files read-only, so "writes nothing" is enforced by
	// the engine rather than by reading the queries — that is what makes it safe
	// to point at a live instance.
	// The opener sets WAL and busy_timeout on a writable handle, the cross-process
	// write coordination RFC 036 D3 requires, so a concurrent app boot never trips
	// on a fresh database file.
	const open = (path: string) =>
		openSqlite({
			filename: path,
			mode: mode.kind === "check" ? "readonly" : "create",
			synchronous: "FULL",
		});
	const appSqlite = open(paths.app);
	const mailSqlite = open(paths.mail);
	const searchSqlite = open(paths.search);
	// One handle, both parameterised repairs: the two clients are the same
	// three lines, and a second copy is a second thing to keep in step.
	const paramRepairClient: SqliteRepairClient = {
		all: async (sql, params) => mailSqlite.sqlite.prepare(sql).all(...params),
		run: async (sql, params) =>
			mailSqlite.sqlite.prepare(sql).run(...params).changes,
	};
	const appRepairClient: SqliteRepairClient = {
		all: async (sql, params) => appSqlite.sqlite.prepare(sql).all(...params),
		run: async (sql, params) =>
			appSqlite.sqlite.prepare(sql).run(...params).changes,
	};
	const app = appSqlite.db;
	const db = mailSqlite.db;
	const searchDb = searchSqlite.db;
	const search = new SearchIndex(
		db,
		syncStore(searchDb, NODE_SQLITE_LIMITS, searchSqlite.immediate),
	);
	const specialUse = createSqliteRepositories(
		{
			app,
			mail: db,
			search: searchDb,
			transactions: {
				app: appSqlite.immediate,
				mail: mailSqlite.immediate,
				search: searchSqlite.immediate,
			},
		},
		NODE_SQLITE_LIMITS,
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
			await filterFromDomainStep(appRepairClient, "check");
			return;
		}

		await displayNameStep(paramRepairClient, "repair", search);

		await strandedSentStep(paramRepairClient, "repair");

		await junkOnlyAddressStep(paramRepairClient, specialUse, "repair");

		await filterFromDomainStep(appRepairClient, "repair");

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
