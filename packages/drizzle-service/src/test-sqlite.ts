import { join } from "node:path";
import {
	SQLITE_DATABASE_ENV,
	type SqliteDatabasePaths,
	type SqliteDatabases,
} from "./databases.js";
import { openSqlite, openTestSqlite, type SqliteHandle } from "./sqlite.js";
import { statementLog } from "./test-query-plan.js";
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
export const applyShippedMigrations = (
	sqlite: Pick<SqliteHandle, "exec">,
): void => {
	for (const set of MIGRATION_SETS) applyMigrationSet(sqlite, set);
};

/**
 * A migrated in-memory database and a drizzle handle over it, for a test that
 * wants one repo and no file to clean up.
 */
export const createShippedSqliteDb = (): SqliteHandle => {
	const handle = openTestSqlite(statementLog);
	applyShippedMigrations(handle);
	return handle;
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
		const handle = openSqlite({
			filename: paths[set],
			mode: "create",
		});
		applyMigrationSet(handle, set);
		handle.close();
		process.env[SQLITE_DATABASE_ENV[set]] = paths[set];
	}
	return paths;
};

export const sharedDatabases = ({
	db,
	immediate,
}: Pick<SqliteHandle, "db" | "immediate">): SqliteDatabases => {
	const run = (work: () => unknown[]): unknown[] => immediate(work);
	return {
		app: db,
		mail: db,
		search: db,
		transactions: { app: run, mail: run, search: run },
	};
};
