import { readFileSync } from "node:fs";
import type Database from "better-sqlite3";

// Read the committed SQLite migrations — the DDL a self-host deployment
// actually runs — so a test can exercise the shipped shape instead of the one
// `pushSQLiteSchema` derives from the drizzle table objects. The two are
// generated from the same entities but only the pushed one is regenerated on
// every run, so drift between them is invisible to any test that pushes
// (reader#73). Reading the files means a test fails when they drift, and
// tracks them when they change.

/** The three databases a deployment migrates, one committed set each (#1420). */
export type MigrationSet = "app" | "mail" | "search";

export const MIGRATION_SETS: readonly MigrationSet[] = [
	"app",
	"mail",
	"search",
];

const setDir = (set: MigrationSet): URL =>
	new URL(`../../../deploy/vps/migrations-sqlite/${set}/`, import.meta.url);

const migrationSql = (set: MigrationSet, tag: string): string =>
	readFileSync(new URL(`${tag}.sql`, setDir(set)), "utf8");

interface MigrationJournalEntry {
	idx: number;
	tag: string;
}

/** Every committed migration of a set, in the order the migrator runs them. */
const migrationJournal = (set: MigrationSet): MigrationJournalEntry[] =>
	(
		JSON.parse(
			readFileSync(new URL("meta/_journal.json", setDir(set)), "utf8"),
		) as { entries: MigrationJournalEntry[] }
	).entries.sort((left, right) => left.idx - right.idx);

/** The `CREATE TABLE` block for one mail table, as the mail baseline declares it. */
export const shippedTableDdl = (table: string): string => {
	const [baseline] = migrationJournal("mail");
	const match = migrationSql("mail", baseline.tag).match(
		new RegExp(`CREATE TABLE \`${table}\` \\([\\s\\S]*?\\n\\);`),
	);
	if (!match) {
		throw new Error(`${table} DDL not found in migration ${baseline.tag}`);
	}
	return match[0];
};

/** The one statement of the mail baseline that creates a named index. */
export const shippedIndexDdl = (index: string): string => {
	const [baseline] = migrationJournal("mail");
	const statement = migrationSql("mail", baseline.tag)
		.split("--> statement-breakpoint")
		.find((candidate) => candidate.includes(`INDEX \`${index}\``));
	if (!statement) {
		throw new Error(`${index} not found in migration ${baseline.tag}`);
	}
	return statement;
};

/** Every statement of a set's committed migrations, in the order the migrator runs them. */
export const migrationStatements = (set: MigrationSet): string[] =>
	migrationJournal(set).flatMap((entry) =>
		migrationSql(set, entry.tag).split("--> statement-breakpoint"),
	);

/** Run every committed migration of a set against an open database. */
export const applyMigrationSet = (
	sqlite: Database.Database,
	set: MigrationSet,
): void => {
	for (const statement of migrationStatements(set)) {
		sqlite.exec(statement);
	}
};
