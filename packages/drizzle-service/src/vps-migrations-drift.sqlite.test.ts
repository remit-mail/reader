import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
	generateSQLiteDrizzleJson,
	generateSQLiteMigration,
} from "drizzle-kit/api";

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

const CONFIGS = [
	"deploy/vps/migrate/drizzle.entities.sqlite.config.ts",
	"deploy/vps/migrate/drizzle.auth.sqlite.config.ts",
	"deploy/vps/migrate/drizzle.meta.sqlite.config.ts",
];

type DrizzleConfig = { schema: string; out: string };

const loadConfig = async (path: string): Promise<DrizzleConfig> =>
	(
		(await import(new URL(path, REPO_ROOT).href)) as {
			default: DrizzleConfig;
		}
	).default;

const latestSnapshot = (out: string): Record<string, unknown> => {
	const dir = new URL(`${out}/`, REPO_ROOT);
	const journal = JSON.parse(
		readFileSync(new URL("meta/_journal.json", dir), "utf8"),
	) as { entries: Array<{ idx: number }> };
	const idx = Math.max(...journal.entries.map((entry) => entry.idx));
	return JSON.parse(
		readFileSync(
			new URL(`meta/${String(idx).padStart(4, "0")}_snapshot.json`, dir),
			"utf8",
		),
	) as Record<string, unknown>;
};

describe("committed sqlite migrations", () => {
	for (const configPath of CONFIGS) {
		test(`${configPath} — the set matches its schema`, async () => {
			const config = await loadConfig(configPath);
			const schema = (await import(
				new URL(config.schema, REPO_ROOT).href
			)) as Record<string, unknown>;

			const drift = await generateSQLiteMigration(
				latestSnapshot(config.out) as unknown as Parameters<
					typeof generateSQLiteMigration
				>[0],
				await generateSQLiteDrizzleJson(schema),
			);

			assert.deepEqual(
				drift,
				[],
				`the committed migrations in ${config.out} no longer match ${config.schema} — regenerate them with drizzle-kit generate`,
			);
		});
	}

	test("declare mailbox.highest_modseq as text", async () => {
		const { out } = await loadConfig(CONFIGS[0]);
		const snapshot = latestSnapshot(out) as {
			tables: Record<
				string,
				{ columns: Record<string, { type: string; notNull: boolean }> }
			>;
		};
		const column = snapshot.tables.mailbox.columns.highest_modseq;

		// A mod-sequence is an unsigned 63-bit value carried as decimal digits and
		// parsed to BigInt, and the stored cursor also takes a `<group>:<uid>`
		// form. Numeric affinity would hand both back as numbers.
		assert.equal(column.type, "text");
		assert.equal(column.notNull, true);
	});
});
