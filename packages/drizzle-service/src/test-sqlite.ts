import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { SQLITE_DATABASE_ENV, type SqliteDatabasePaths } from "./databases.js";
import type { Db } from "./db.js";
import {
	applyMigrationSet,
	MIGRATION_SETS,
} from "./test-shipped-sqlite-schema.js";

/**
 * The store a test runs against: the committed SQLite migrations, in the order
 * the migrator runs them, over the same engine a self-host deployment boots.
 * Applying the shipped DDL rather than pushing the drizzle table objects is the
 * point — a test then fails when the two drift (reader#73).
 *
 * All three sets land in the one database, which a test then hands to every
 * repo whatever database the repo runs on in a deployment. Their tables do not
 * overlap, so nothing collides.
 */
export const applyShippedMigrations = (sqlite: Database.Database): void => {
	for (const set of MIGRATION_SETS) applyMigrationSet(sqlite, set);
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

/**
 * The three database files a deployment runs on, each migrated with its own
 * set, under `directory` — and the environment pointed at them, so a
 * composition root a test builds opens them exactly as a deployment does.
 */
export const createShippedSqliteFiles = (
	directory: string,
): SqliteDatabasePaths => {
	const paths: SqliteDatabasePaths = {
		app: join(directory, "app.db"),
		mail: join(directory, "mail.db"),
		search: join(directory, "search.db"),
	};
	for (const set of MIGRATION_SETS) {
		const sqlite = new Database(paths[set]);
		applyMigrationSet(sqlite, set);
		sqlite.close();
		process.env[SQLITE_DATABASE_ENV[set]] = paths[set];
	}
	return paths;
};
