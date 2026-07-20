import { readFileSync } from "node:fs";
import type Database from "better-sqlite3";

// Read the committed SQLite entity migrations — the DDL a self-host deployment
// actually runs — so a test can exercise the shipped shape instead of the one
// `pushSQLiteSchema` derives from the drizzle table objects. The two are
// generated from the same entities but only the pushed one is regenerated on
// every run, so drift between them is invisible to any test that pushes
// (reader#73). Reading the files means a test fails when they drift, and
// tracks them when they change.

const MIGRATIONS_DIR = new URL(
	"../../../deploy/vps/migrations-sqlite/entities/",
	import.meta.url,
);

export const migrationSql = (tag: string): string =>
	readFileSync(new URL(`${tag}.sql`, MIGRATIONS_DIR), "utf8");

/** The `CREATE TABLE` block for one table, as that migration declares it. */
export const shippedTableDdl = (tag: string, table: string): string => {
	const match = migrationSql(tag).match(
		new RegExp(`CREATE TABLE \`${table}\` \\([\\s\\S]*?\\n\\);`),
	);
	if (!match) {
		throw new Error(`${table} DDL not found in migration ${tag}`);
	}
	return match[0];
};

/** Run every statement of a committed migration against an open database. */
export const applyMigration = (
	sqlite: Database.Database,
	tag: string,
): void => {
	for (const statement of migrationSql(tag).split("--> statement-breakpoint")) {
		sqlite.exec(statement);
	}
};
