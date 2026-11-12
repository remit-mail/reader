import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import * as entities from "@remit/drizzle-sqlite-schema";
import {
	generateDrizzleJson,
	generateMigration,
} from "drizzle-kit/payload/sqlite";
import { getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";

/**
 * Every committed SQLite migration set must describe the schema its drizzle
 * source declares.
 *
 * Nothing else checked this. The previous guard shelled out to
 * `npm-scripts/check-vps-migrations.mjs`, which is stripped from this tree, so
 * it skipped on every run. Every other SQLite test pushes its schema from the
 * drizzle table objects, so a migration set that has fallen behind those
 * objects still passes the whole suite while deployments run the stale shape —
 * which is how `mailbox.highest_modseq` shipped as `integer` for as long as it
 * did (reader#73). SQLite column types are affinity rather than constraint, so
 * a wrong declaration corrupts values instead of rejecting them.
 *
 * This is the same diff `drizzle-kit generate` takes, run in-process against
 * each set's latest committed snapshot. A non-empty result means someone
 * changed a schema without regenerating:
 *
 *   npx drizzle-kit generate --config <the config named below>
 *
 * The schema and output paths come from the configs themselves, so a set stays
 * covered when either moves.
 */

const REPO_ROOT = new URL("../../../", import.meta.url);

const CONFIGS = {
	app: "packages/migrate/drizzle.app.sqlite.config.ts",
	mail: "packages/migrate/drizzle.mail.sqlite.config.ts",
	search: "packages/migrate/drizzle.search.sqlite.config.ts",
	mcp: "packages/migrate/drizzle.mcp.sqlite.config.ts",
};

type DrizzleConfig = { schema: string[]; out: string };

const loadConfig = async (path: string): Promise<DrizzleConfig> =>
	(
		(await import(new URL(path, REPO_ROOT).href)) as {
			default: DrizzleConfig;
		}
	).default;

const loadSchema = async (
	config: DrizzleConfig,
): Promise<Record<string, unknown>> =>
	Object.assign(
		{},
		...(await Promise.all(
			config.schema.map(
				(path) =>
					import(new URL(path, REPO_ROOT).href) as Promise<
						Record<string, unknown>
					>,
			),
		)),
	);

const tableNames = (schema: Record<string, unknown>): string[] =>
	Object.values(schema)
		.filter((value) => is(value, SQLiteTable))
		.map((table) => getTableName(table as SQLiteTable));

type Snapshot = Parameters<typeof generateMigration>[0];

/** Every migration folder of a set, in the order the migrator runs them. */
const migrationFolders = (out: string): string[] =>
	readdirSync(new URL(`${out}/`, REPO_ROOT)).sort();

const latestSnapshot = (out: string): Snapshot =>
	JSON.parse(
		readFileSync(
			new URL(
				`${out}/${migrationFolders(out).at(-1)}/snapshot.json`,
				REPO_ROOT,
			),
			"utf8",
		),
	) as Snapshot;

describe("committed sqlite migrations", () => {
	for (const configPath of Object.values(CONFIGS)) {
		test(`${configPath} — the set matches its schema`, async () => {
			const config = await loadConfig(configPath);
			const schema = await loadSchema(config);

			const drift = await generateMigration(
				latestSnapshot(config.out),
				await generateDrizzleJson(schema),
			);

			assert.deepEqual(
				drift,
				[],
				`the committed migrations in ${config.out} no longer match ${config.schema} — regenerate them with drizzle-kit generate`,
			);
		});
	}

	// A new TypeSpec entity has to be placed in a database: one that is in
	// neither set is never migrated anywhere, and one in both is two tables.
	test("place every generated entity table in exactly one database", async () => {
		const [app, mail] = await Promise.all(
			[CONFIGS.app, CONFIGS.mail].map(async (path) =>
				tableNames(await loadSchema(await loadConfig(path))),
			),
		);
		const placed = [...app, ...mail].sort();
		assert.deepEqual(placed, [...new Set(placed)]);
		for (const table of tableNames(entities)) {
			assert.ok(placed.includes(table), `${table} is in no database`);
		}
	});

	test("keep the search set free of drizzle tables", async () => {
		const config = await loadConfig(CONFIGS.search);
		assert.deepEqual(tableNames(await loadSchema(config)), []);
	});

	test("declare mailbox.highest_modseq as text", async () => {
		const { out } = await loadConfig(CONFIGS.mail);
		const column = latestSnapshot(out).ddl.find(
			(entity) =>
				entity.entityType === "columns" &&
				entity.table === "mailbox" &&
				entity.name === "highest_modseq",
		) as { type: string; notNull: boolean } | undefined;
		assert.ok(column, "mailbox.highest_modseq is in the latest snapshot");

		// A mod-sequence is an unsigned 63-bit value carried as decimal digits and
		// parsed to BigInt, and the stored cursor also takes a `<group>:<uid>`
		// form. Numeric affinity would hand both back as numbers.
		assert.equal(column.type, "text");
		assert.equal(column.notNull, true);
	});
});
