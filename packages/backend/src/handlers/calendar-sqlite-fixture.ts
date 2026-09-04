import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyShippedMigrations } from "@remit/drizzle-service/test-sqlite";
import Database from "better-sqlite3";
import { buildSqliteClient } from "../service/compose-sqlite.js";
import type { RemitClient } from "../service/data-client.js";

/**
 * A handler test's store: the backend's own SQLite composition, over the DDL a
 * self-host deployment actually runs.
 *
 * The migrations are applied rather than pushed from the drizzle table objects,
 * so a handler test exercises the shipped column shapes. The client is built by
 * `compose-sqlite.ts`, the composition root a self-host process boots, so
 * nothing here is a second wiring that could drift from the one that ships.
 *
 * One per test file: every row is scoped by account config, so a test that
 * mints its own account config sees only what it wrote.
 */
export const createCalendarSqliteClient = async (): Promise<{
	client: RemitClient;
	cleanup: () => void;
}> => {
	const directory = mkdtempSync(join(tmpdir(), "remit-calendar-handlers-"));
	const path = join(directory, "remit.db");
	const sqlite = new Database(path);
	applyShippedMigrations(sqlite);
	sqlite.close();

	process.env.SQLITE_DB_PATH = path;
	return {
		client: await buildSqliteClient(),
		cleanup: () => rmSync(directory, { recursive: true, force: true }),
	};
};
