import { fileURLToPath } from "node:url";
import { type MigrationMeta, readMigrationFiles } from "drizzle-orm/migrator";
import type { SqliteHandle } from "./sqlite.js";

// Read the committed SQLite migrations — the DDL a self-host deployment
// actually runs — so a test can exercise the shipped shape instead of the one
// `pushSchema` derives from the drizzle table objects. The two are
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

const setDir = (set: MigrationSet): string =>
	fileURLToPath(
		new URL(`../../../deploy/vps/migrations-sqlite/${set}/`, import.meta.url),
	);

/** Every committed migration of a set, in the order the migrator runs them. */
const migrationsOf = (set: MigrationSet): MigrationMeta[] =>
	readMigrationFiles({ migrationsFolder: setDir(set) });

/** The `CREATE TABLE` block for one mail table, as the mail baseline declares it. */
export const shippedTableDdl = (table: string): string => {
	const [baseline] = migrationsOf("mail");
	const match = baseline.sql
		.join("--> statement-breakpoint")
		.match(new RegExp(`CREATE TABLE \`${table}\` \\([\\s\\S]*?\\n\\);`));
	if (!match) {
		throw new Error(`${table} DDL not found in migration ${baseline.name}`);
	}
	return match[0];
};

/** The one statement of the mail baseline that creates a named index. */
export const shippedIndexDdl = (index: string): string => {
	const [baseline] = migrationsOf("mail");
	const statement = baseline.sql.find((candidate) =>
		candidate.includes(`INDEX \`${index}\``),
	);
	if (!statement) {
		throw new Error(`${index} not found in migration ${baseline.name}`);
	}
	return statement;
};

/** Every statement of a set's committed migrations, in the order the migrator runs them. */
export const migrationStatements = (set: MigrationSet): string[] =>
	migrationsOf(set).flatMap((migration) => migration.sql);

/** Run every committed migration of a set against an open database. */
export const applyMigrationSet = (
	sqlite: Pick<SqliteHandle, "exec">,
	set: MigrationSet,
): void => {
	for (const statement of migrationStatements(set)) {
		sqlite.exec(statement);
	}
};
