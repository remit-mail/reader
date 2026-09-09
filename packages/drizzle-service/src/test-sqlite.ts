import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Db } from "./db.js";
import {
	applyMigration,
	migrationJournal,
} from "./test-shipped-sqlite-schema.js";

/**
 * The store a test runs against: the committed SQLite entity migrations, in the
 * order the migrator runs them, over the same engine a self-host deployment
 * boots. Applying the shipped DDL rather than pushing the drizzle table objects
 * is the point — a test then fails when the two drift (reader#73).
 */
export const applyShippedMigrations = (sqlite: Database.Database): void => {
	for (const entry of [...migrationJournal()].sort(
		(left, right) => left.idx - right.idx,
	)) {
		applyMigration(sqlite, entry.tag);
	}
};

/**
 * A migrated in-memory database and a drizzle handle over it, for a test that
 * wants one repo and no file to clean up.
 */
export const createShippedSqliteDb = (): {
	db: Db<Record<string, unknown>>;
	sqlite: Database.Database;
	close: () => void;
} => {
	const sqlite = new Database(":memory:");
	applyShippedMigrations(sqlite);
	return {
		db: drizzle(sqlite) as unknown as Db<Record<string, unknown>>,
		sqlite,
		close: () => sqlite.close(),
	};
};
