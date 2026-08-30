import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { buildSqliteClient } from "../service/compose-sqlite.js";
import type { RemitClient } from "../service/data-client.js";

/**
 * A calendar handler test's store: the backend's own SQLite composition, over
 * the DDL a self-host deployment actually runs.
 *
 * The migrations are read rather than pushed from the drizzle table objects, so
 * a handler test exercises the shipped column shapes — the same reason
 * `test-shipped-sqlite-schema.ts` exists on the repository side. The client is
 * built by `compose-sqlite.ts`, which is the composition root a self-host
 * process boots, so nothing here is a second wiring of the calendar repos that
 * could drift from the one that ships.
 */
const MIGRATIONS = new URL(
	"../../../../deploy/vps/migrations-sqlite/entities/",
	import.meta.url,
);

interface Journal {
	entries: Array<{ idx: number; tag: string }>;
}

const applyEntityMigrations = (sqlite: Database.Database): void => {
	const journal = JSON.parse(
		readFileSync(new URL("meta/_journal.json", MIGRATIONS), "utf8"),
	) as Journal;
	const ordered = [...journal.entries].sort(
		(left, right) => left.idx - right.idx,
	);
	for (const entry of ordered) {
		const sql = readFileSync(new URL(`${entry.tag}.sql`, MIGRATIONS), "utf8");
		for (const statement of sql.split("--> statement-breakpoint")) {
			if (statement.trim() === "") continue;
			sqlite.exec(statement);
		}
	}
};

/**
 * A migrated database and the client that reads it. One per test file: every
 * calendar row is scoped by account config, so a test that mints its own
 * account config sees only what it wrote.
 */
export const createCalendarSqliteClient = async (): Promise<RemitClient> => {
	const path = join(
		mkdtempSync(join(tmpdir(), "remit-calendar-handlers-")),
		"remit.db",
	);
	const sqlite = new Database(path);
	applyEntityMigrations(sqlite);
	sqlite.close();

	process.env.SQLITE_DB_PATH = path;
	return buildSqliteClient();
};
