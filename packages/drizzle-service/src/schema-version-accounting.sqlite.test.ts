import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrateSqlite, openSqlite, type SqliteHandle } from "./sqlite.js";

/**
 * A release's `schemaVersion` and an instance's `currentSchemaVersion` have to
 * be the same quantity, because the self-update consent screen subtracts one
 * from the other: `schemaVersion > currentSchemaVersion` is the whole of
 * "installing this release runs a migration" (#279).
 *
 * They are computed by two different programs from two different sources. The
 * manifest counts the drizzle migrations (npm-scripts/lib/update-manifest.mjs); the
 * wrapper counts rows in the `__drizzle_migrations_*` tables on the live
 * database (deploy/vps/remit). Nothing tied the two together, and a run that
 * reported ten against a manifest's nine inverted the derivation with no test
 * to catch it.
 *
 * This applies the shipped migration sets with the shipped migrator, each to
 * its own database file, and asserts the two quantities agree: one applied row
 * per migration, in exactly the tables and files the wrapper counts.
 */

const REPO_ROOT = new URL("../../../", import.meta.url);

const MIGRATIONS_ROOT = new URL("deploy/vps/migrations-sqlite/", REPO_ROOT);

const read = (path: string): string =>
	readFileSync(new URL(path, REPO_ROOT), "utf8");

interface MigrationSet {
	database: string;
	set: string;
	table: string;
}

/**
 * The sets the migrate one-shot applies, taken from its own list rather than
 * restated here: a set added, renamed or dropped there is one this test then
 * migrates and counts, instead of one it silently stops covering. The folder is
 * the path inside the image, where the migrations are staged at the working
 * directory; in this tree they are under deploy/vps.
 */
const migrationSets = (): MigrationSet[] => {
	const source = read("packages/migrate/src/migration-sets.ts");
	const sets = [
		...source.matchAll(
			/database:\s*"(\w+)",\s*migrationsFolder:\s*"migrations-sqlite\/(\w+)",\s*migrationsTable:\s*"(\w+)",/g,
		),
	].map(([, database, set, table]) => ({ database, set, table }));
	assert.ok(
		sets.length > 0,
		"no sqlite migration sets found in the migrate entrypoint",
	);
	return sets;
};

const migrationsOf = (set: string): unknown[] =>
	readMigrationFiles({
		migrationsFolder: fileURLToPath(new URL(set, MIGRATIONS_ROOT)),
	});

/**
 * The `<database>:<table>` pairs `read_schema_version` in the wrapper sums on
 * the live databases, each database read from the file it is configured on.
 */
const wrapperCountedTables = (): string[] => {
	const match = read("deploy/vps/remit").match(
		/for p in ((?:\$_sv_\w+:__drizzle_migrations_\w+ ?)+); do/,
	);
	assert.ok(match, "the wrapper no longer sums any __drizzle_migrations table");
	return match[1]
		.trim()
		.split(/\s+/)
		.map((pair) => pair.replace(/^\$_sv_/, ""));
};

describe("schema version accounting", () => {
	const dir = mkdtempSync(join(tmpdir(), "remit-schema-version-"));
	const sets = migrationSets();
	const databases = new Map(
		[...new Set(sets.map(({ database }) => database))].map((database) => {
			const handle = openSqlite({
				filename: join(dir, `${database}.db`),
				mode: "create",
			});
			return [database, handle] as const;
		}),
	);
	const sqliteOf = (database: string): SqliteHandle => {
		const sqlite = databases.get(database);
		assert.ok(sqlite, `no database file for ${database}`);
		return sqlite;
	};
	const migrateAll = (): void => {
		for (const { database, set, table } of sets) {
			migrateSqlite(sqliteOf(database), {
				migrationsFolder: fileURLToPath(new URL(set, MIGRATIONS_ROOT)),
				migrationsTable: table,
			});
		}
	};
	migrateAll();

	after(() => {
		for (const handle of databases.values()) handle.close();
		rmSync(dir, { recursive: true, force: true });
	});

	const rows = ({ database, table }: MigrationSet): number =>
		(
			sqliteOf(database)
				.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`)
				.get() as {
				n: number;
			}
		).n;

	test("a fully migrated database holds one row per migration", () => {
		for (const set of sets) {
			assert.equal(
				rows(set),
				migrationsOf(set.set).length,
				`${set.table} does not hold one row per migration in the ${set.set} set`,
			);
		}
	});

	// The sum is the quantity both sides publish, and the manifest derives it
	// from these same migration folders — so this is `deriveSchemaVersion` against the
	// count the wrapper reads back off a migrated instance.
	test("the total equals the schema version the manifest derives", () => {
		const applied = sets.reduce((total, set) => total + rows(set), 0);
		const derived = sets.reduce(
			(total, { set }) => total + migrationsOf(set).length,
			0,
		);
		assert.equal(applied, derived);
	});

	// Same number, same tables, same files. A set the migrator writes and the
	// wrapper does not count is a version that reads low forever, which inverts
	// the consent screen's comparison rather than failing it.
	test("the wrapper counts exactly the tables the migrator writes", () => {
		assert.deepEqual(
			wrapperCountedTables().sort(),
			sets.map(({ database, table }) => `${database}:${table}`).sort(),
		);
	});

	// Forward-only: the migrator is run on every boot, and a second pass that
	// re-recorded an applied migration would lift the count above the migration
	// sum — the shape of the drift #279 reported.
	test("a second migrate run records nothing further", () => {
		const before = sets.reduce((total, set) => total + rows(set), 0);
		migrateAll();
		assert.equal(
			sets.reduce((total, set) => total + rows(set), 0),
			before,
		);
	});
});
