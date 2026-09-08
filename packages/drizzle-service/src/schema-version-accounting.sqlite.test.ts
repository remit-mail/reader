import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * A release's `schemaVersion` and an instance's `currentSchemaVersion` have to
 * be the same quantity, because the self-update consent screen subtracts one
 * from the other: `schemaVersion > currentSchemaVersion` is the whole of
 * "installing this release runs a migration" (#279).
 *
 * They are computed by two different programs from two different sources. The
 * manifest sums the drizzle journals (npm-scripts/lib/update-manifest.mjs); the
 * wrapper counts rows in the `__drizzle_migrations_*` tables on the live
 * database (deploy/vps/remit). Nothing tied the two together, and a run that
 * reported ten against a manifest's nine inverted the derivation with no test
 * to catch it.
 *
 * This applies the shipped migration sets with the shipped migrator and asserts
 * the two quantities agree: one applied row per journal entry, in exactly the
 * tables the wrapper counts.
 */

const REPO_ROOT = new URL("../../../", import.meta.url);

const MIGRATIONS_ROOT = new URL("deploy/vps/migrations-sqlite/", REPO_ROOT);

const read = (path: string): string =>
	readFileSync(new URL(path, REPO_ROOT), "utf8");

interface MigrationSet {
	set: string;
	table: string;
}

/**
 * The sets the migrate one-shot applies, taken from the entrypoint itself
 * rather than restated here: a set added, renamed or dropped there is one this
 * test then migrates and counts, instead of one it silently stops covering.
 * The folder is the path inside the image, where the migrations are staged at
 * the working directory; in this tree they are under deploy/vps.
 */
const migrationSets = (): MigrationSet[] => {
	const source = read("packages/migrate/src/run-migrate.ts");
	const sets = [
		...source.matchAll(
			/migrationsFolder:\s*"migrations-sqlite\/(\w+)",\s*migrationsTable:\s*"(\w+)",/g,
		),
	].map(([, set, table]) => ({ set, table }));
	assert.ok(
		sets.length > 0,
		"no sqlite migration sets found in the migrate entrypoint",
	);
	return sets;
};

const journalEntries = (set: string): unknown[] => {
	const journal = JSON.parse(
		readFileSync(new URL(`${set}/meta/_journal.json`, MIGRATIONS_ROOT), "utf8"),
	) as { entries: unknown[] };
	return journal.entries;
};

/** The tables `read_schema_version` in the wrapper sums on the live database. */
const wrapperCountedTables = (): string[] => {
	const match = read("deploy/vps/remit").match(
		/for t in ((?:__drizzle_migrations_\w+ ?)+); do/,
	);
	assert.ok(match, "the wrapper no longer sums any __drizzle_migrations table");
	return match[1].trim().split(/\s+/);
};

describe("schema version accounting", () => {
	const dir = mkdtempSync(join(tmpdir(), "remit-schema-version-"));
	const sets = migrationSets();
	const sqlite = new Database(join(dir, "remit.db"));
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");
	const db = drizzle(sqlite);
	for (const { set, table } of sets) {
		migrate(db, {
			migrationsFolder: fileURLToPath(new URL(set, MIGRATIONS_ROOT)),
			migrationsTable: table,
		});
	}

	after(() => {
		sqlite.close();
		rmSync(dir, { recursive: true, force: true });
	});

	const rows = (table: string): number =>
		(
			sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {
				n: number;
			}
		).n;

	test("a fully migrated database holds one row per journal entry", () => {
		for (const { set, table } of sets) {
			assert.equal(
				rows(table),
				journalEntries(set).length,
				`${table} does not hold one row per entry in the ${set} journal`,
			);
		}
	});

	// The sum is the quantity both sides publish, and the manifest derives it
	// from these same journals — so this is `deriveSchemaVersion` against the
	// count the wrapper reads back off a migrated instance.
	test("the total equals the schema version the manifest derives", () => {
		const applied = sets.reduce((total, { table }) => total + rows(table), 0);
		const derived = sets.reduce(
			(total, { set }) => total + journalEntries(set).length,
			0,
		);
		assert.equal(applied, derived);
	});

	// Same number, same tables. A set the migrator writes and the wrapper does
	// not count is a version that reads low forever, which inverts the consent
	// screen's comparison rather than failing it.
	test("the wrapper counts exactly the tables the migrator writes", () => {
		assert.deepEqual(
			wrapperCountedTables().sort(),
			sets.map(({ table }) => table).sort(),
		);
	});

	// Forward-only: the migrator is run on every boot, and a second pass that
	// re-recorded an applied migration would lift the count above the journal
	// sum — the shape of the drift #279 reported.
	test("a second migrate run records nothing further", () => {
		const before = sets.reduce((total, { table }) => total + rows(table), 0);
		for (const { set, table } of sets) {
			migrate(db, {
				migrationsFolder: fileURLToPath(new URL(set, MIGRATIONS_ROOT)),
				migrationsTable: table,
			});
		}
		assert.equal(
			sets.reduce((total, { table }) => total + rows(table), 0),
			before,
		);
	});
});
