import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
	generateSQLiteDrizzleJson,
	generateSQLiteMigration,
} from "drizzle-kit/api";
import * as schemaFullSqlite from "./schema-full-sqlite.js";

/**
 * The committed SQLite entity migrations must describe the same schema the
 * entity package declares.
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
 * the latest committed snapshot. A non-empty result means someone changed the
 * entities without regenerating:
 *
 *   npx drizzle-kit generate --config deploy/vps/migrate/drizzle.entities.sqlite.config.ts
 */

const MIGRATIONS_DIR = new URL(
	"../../../deploy/vps/migrations-sqlite/entities/",
	import.meta.url,
);

const latestSnapshot = (): Record<string, unknown> => {
	const journal = JSON.parse(
		readFileSync(new URL("meta/_journal.json", MIGRATIONS_DIR), "utf8"),
	) as { entries: Array<{ idx: number }> };
	const idx = Math.max(...journal.entries.map((entry) => entry.idx));
	return JSON.parse(
		readFileSync(
			new URL(
				`meta/${String(idx).padStart(4, "0")}_snapshot.json`,
				MIGRATIONS_DIR,
			),
			"utf8",
		),
	) as Record<string, unknown>;
};

describe("committed sqlite entity migrations", () => {
	test("describe the schema the entities declare", async () => {
		const fresh = await generateSQLiteDrizzleJson(
			schemaFullSqlite as unknown as Record<string, unknown>,
		);
		const drift = await generateSQLiteMigration(
			latestSnapshot() as unknown as Parameters<
				typeof generateSQLiteMigration
			>[0],
			fresh,
		);

		assert.deepEqual(
			drift,
			[],
			"the committed migrations no longer match the entity schema — regenerate them with drizzle-kit generate",
		);
	});

	test("declare mailbox.highest_modseq as text", () => {
		const snapshot = latestSnapshot() as {
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
