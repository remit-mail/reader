// esbuild bundles this as text (see npm-scripts/docker-bundle.mjs's ".sql"
// loader) so the migrate step runs the exact SQL the test harness applies —
// one source of truth, two consumers.
import sqliteAddressMutedIndexSql from "../../../npm-scripts/sqlite-address-muted-index.sql";
import sqliteAddressSightingsIndexSql from "../../../npm-scripts/sqlite-address-sightings-index.sql";
import { sqliteDatabasePathsFromEnv } from "../../drizzle-service/src/databases.js";
import {
	type DisplayNameRepairClient,
	type DisplayNameRepairMode,
	formatDisplayNameReport,
	sweepDisplayNames,
} from "../../drizzle-service/src/repair/address-display-name.js";
import {
	type DuplicateMailRepairMode,
	formatDuplicateMailReport,
	sweepDuplicateMailboxMail,
} from "../../drizzle-service/src/repair/duplicate-mailbox-mail.js";
import {
	type ForwardedPartsRepairMode,
	formatForwardedPartsReport,
	sweepForwardedMessageParts,
} from "../../drizzle-service/src/repair/forwarded-message-parts.js";
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
import {
	formatThreadRootReport,
	moveMisfiledThreadRows,
	type ThreadRootRepairMode,
} from "../../drizzle-service/src/repair/thread-root-spelling.js";
import { MailboxSpecialUseRepo } from "../../drizzle-service/src/repos/i4-mailbox-special-use.js";
import { SearchIndex } from "../../drizzle-service/src/search/thread-message-search.js";
// Reached by module path rather than through either package's entry point: this
// entrypoint is bundled by esbuild, and everything reached this way is pure
// TypeScript over the drizzle query builder, so bundling it drags in no native
// driver — better-sqlite3 stays external and dynamically imported below.
import { logger } from "../../logger-lambda/src/logger.js";
import { applyMigrationSets } from "./migration-sets.js";

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
 * DDL objects around them, and rewrites row content in five places.
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
 * see the repair module for what a SQL twin of it destroys. It removes the
 * address and keeps the rest of the name — the remedy is the claim, not the
 * text around it.
 *
 * The third is an outbox row stranded at `sent` (#824), and the reason is
 * again delivery. The message was sent, the copy for the Sent folder never
 * landed, and `sent` is the status the Outbox list hides — so it is mail the
 * user has lost sight of on an instance already running. Purge and re-sync is
 * no remedy: the message is on no server folder to re-fetch. It flips a status
 * and writes the reason, on rows an hour past any retry, and touches nothing
 * else.
 *
 * The fourth is mail the folder dedupe migration could not move onto the
 * surviving row (#386). The migration parks it, and it is removed here through
 * `deleteMessageSubtree`. In
 * `--check` mode the report also counts the duplicate paths the pending
 * migration will merge, since nothing has been parked yet.
 *
 * The fifth is a forwarded message whose part row the MIME walker overwrote
 * with its own root. The lost row is only on the mail server, so the repair
 * drops the message's part rows, and message sync re-reads the structure of
 * any message left without parts. Purge and re-sync would do the same for
 * every message rather than these.

 */

/**
 * `--check` is the read-only mode of this same entrypoint (D17): it reports what
 * the repair would do and applies nothing at all, migrations included, so it can
 * be pointed at a live instance. `--rebuild-search` runs the full migration and
 * then rebuilds the search index from the mail database, the recovery for an
 * index that has drifted. Anything else is refused rather than ignored —
 * a mistyped flag that silently ran the full migration is the failure mode this
 * guards.
 */
type Mode = "migrate" | "check" | "rebuild-search";

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
	if (argv.length === 1 && argv[0] === "--rebuild-search") {
		return "rebuild-search";
	}
	throw new Error(
		`unrecognised argument: ${argv.join(" ")} — the options are --check and --rebuild-search`,
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
 * one repair is that none of them needs rewriting — a read, never a write lock.
 */
const displayNameStep = async (
	client: DisplayNameRepairClient,
	mode: DisplayNameRepairMode,
): Promise<{ rewroteThreadRows: boolean }> => {
	const report = await sweepDisplayNames(client, mode);
	for (const line of formatDisplayNameReport(report)) {
		logStep({ step: "display-name-repair" }, line);
	}
	return {
		rewroteThreadRows: report.sites.some(
			(site) => site.table === "thread_message" && site.rewritten > 0,
		),
	};
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

const duplicateMailStep = async (
	db: Parameters<typeof sweepDuplicateMailboxMail>[0],
	mode: DuplicateMailRepairMode,
): Promise<void> => {
	const report = await sweepDuplicateMailboxMail(db, mode);
	for (const line of formatDuplicateMailReport(report)) {
		logStep({ step: "duplicate-mailbox-mail-repair" }, line);
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

const forwardedPartsStep = async (
	db: Parameters<typeof sweepForwardedMessageParts>[0],
	mode: ForwardedPartsRepairMode,
): Promise<void> => {
	const report = await sweepForwardedMessageParts(db, mode);
	for (const line of formatForwardedPartsReport(report)) {
		logStep({ step: "forwarded-message-parts-repair" }, line);
	}
};

const threadRootStep = async (
	db: Parameters<typeof moveMisfiledThreadRows>[0],
	search: SearchIndex,
	mode: ThreadRootRepairMode,
): Promise<void> => {
	const report = await moveMisfiledThreadRows(db, search, mode);
	for (const line of formatThreadRootReport(report)) {
		logStep({ step: "thread-root-repair" }, line);
	}
};

type ParamRepairClient = DisplayNameRepairClient &
	StrandedSentRepairClient &
	JunkOnlyRepairClient;

const runSqlite = async (mode: Mode): Promise<void> => {
	const paths = sqliteDatabasePathsFromEnv();

	// Dynamic imports so the module stays bundleable with the native
	// better-sqlite3 binding marked external (see npm-scripts/docker-bundle.mjs).
	const { default: Database } = await import("better-sqlite3");
	const { drizzle: sqliteDrizzle } = await import("drizzle-orm/better-sqlite3");

	// `--check` opens the files read-only, so "writes nothing" is enforced by
	// the engine rather than by reading the queries — that is what makes it safe
	// to point at a live instance.
	const readonly = mode === "check";
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
	const sqliteRepairClient: RepairSqlClient = {
		all: async (sql) => mailSqlite.prepare(sql).all(),
		run: async (sql) => mailSqlite.prepare(sql).run().changes,
	};
	// One handle, both parameterised repairs: the two clients are the same
	// three lines, and a second copy is a second thing to keep in step.
	const paramRepairClient: ParamRepairClient = {
		all: async (sql, params) => mailSqlite.prepare(sql).all(...params),
		run: async (sql, params) => mailSqlite.prepare(sql).run(...params).changes,
	};
	const app = sqliteDrizzle(appSqlite);
	const db = sqliteDrizzle(mailSqlite);
	const searchDb = sqliteDrizzle(searchSqlite);
	const search = new SearchIndex(db, searchDb);
	const specialUse = new MailboxSpecialUseRepo(app, db);
	try {
		if (mode === "check") {
			logReport(await checkThreadMessageCategory(sqliteRepairClient));
			await displayNameStep(paramRepairClient, "check");
			await strandedSentStep(paramRepairClient, "check");
			await duplicateMailStep(db, "check");
			await junkOnlyAddressStep(paramRepairClient, specialUse, "check");
			await threadRootStep(db, search, "check");
			await forwardedPartsStep(db, "check");
			return;
		}

		await applyMigrationSets(
			{ app, mail: db, search: searchDb },
			".",
			(database) =>
				logStep({ database }, "applying schema migrations (sqlite)"),
		);

		// After the generated migrations, which is where the column and the
		// filter's index come from. Its own UPDATE touches only `category`,
		// which the search index does not carry.
		await repairThreadMessageCategoryStep(sqliteRepairClient);

		// It writes `thread_message.from_name`, which the search index carries,
		// so a run that rewrote any thread row rebuilds the index below.
		const displayNames = await displayNameStep(paramRepairClient, "repair");

		// Independent of every other step here: it touches `outbox_message` and
		// `outbox_attachment`.
		await strandedSentStep(paramRepairClient, "repair");

		await duplicateMailStep(db, "repair");

		await threadRootStep(db, search, "repair");

		// Touches only body part rows and mailbox sync cursors.
		await forwardedPartsStep(db, "repair");

		logStep({}, "installing address-sightings index (sqlite)");
		mailSqlite.exec(sqliteAddressSightingsIndexSql);

		logStep({}, "installing address normalized-email index (sqlite)");
		mailSqlite.exec(sqliteAddressMutedIndexSql);

		await junkOnlyAddressStep(paramRepairClient, specialUse, "repair");

		// The search index is written after each mail write and never with it,
		// so it only needs building here when it cannot have followed: an empty
		// index beside existing threads (a new or deleted search database), a
		// repair that rewrote indexed text, or an operator asking for it.
		if (
			mode === "rebuild-search" ||
			displayNames.rewroteThreadRows ||
			(await search.needsRebuild())
		) {
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
	logStep({ mode }, "migrate done");
};

run()
	.then(() => process.exit(0))
	.catch((error: unknown) => {
		logger.error({ error }, "migrate failed");
		process.exit(1);
	});
