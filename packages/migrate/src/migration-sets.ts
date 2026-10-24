import { join } from "node:path";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { SqliteDatabasePaths } from "../../drizzle-service/src/databases.js";

/**
 * The committed migration sets of each database (#1420), as the migrate
 * one-shot applies them. The app database takes two: its own and the MCP
 * authorization server's. `migrationsFolder` is relative to the directory the migrations
 * are staged in: the image's working directory, or deploy/vps in this tree.
 *
 * The wrapper's schema-version read (deploy/vps/remit) counts the same tables in
 * the same database files, and a test holds the two to each other.
 */
export const MIGRATION_SETS = [
	{
		database: "app",
		migrationsFolder: "migrations-sqlite/app",
		migrationsTable: "__drizzle_migrations_app",
	},
	{
		database: "app",
		migrationsFolder: "migrations-sqlite/mcp",
		migrationsTable: "__drizzle_migrations_mcp",
	},
	{
		database: "mail",
		migrationsFolder: "migrations-sqlite/mail",
		migrationsTable: "__drizzle_migrations_mail",
	},
	{
		database: "search",
		migrationsFolder: "migrations-sqlite/search",
		migrationsTable: "__drizzle_migrations_search",
	},
] as const satisfies ReadonlyArray<{
	database: keyof SqliteDatabasePaths;
	migrationsFolder: string;
	migrationsTable: string;
}>;

export type MigrationDatabases = Record<
	keyof SqliteDatabasePaths,
	BetterSQLite3Database<Record<string, unknown>>
>;

/** Apply each database's committed migrations, forward only. */
export const applyMigrationSets = async (
	databases: MigrationDatabases,
	root: string,
	log: (database: string) => void,
): Promise<void> => {
	const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
	for (const set of MIGRATION_SETS) {
		log(set.database);
		migrate(databases[set.database], {
			migrationsFolder: join(root, set.migrationsFolder),
			migrationsTable: set.migrationsTable,
		});
	}
};
