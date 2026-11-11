import { auth_user } from "@remit/auth-service/schema";
import {
	BETTER_SQLITE3_LIMITS,
	openSqliteDatabases,
	runDrizzleAccountConfigErase,
	runDrizzleCascadeDelete,
	type SqliteStores,
	sqliteDatabasePathsFromEnv,
	syncStores,
} from "@remit/drizzle-service";
import type { Logger } from "@remit/logger";
import { createFilesystemStorageService } from "@remit/storage-service/filesystem";
import { eq } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { DeletionCapabilities } from "./deletion-capabilities.js";

const deleteStoragePrefix = async (
	keyPrefix: string,
	log: Logger,
): Promise<void> => {
	await createFilesystemStorageService(
		process.env.STORAGE_LOCAL_PATH ?? ".remit/storage",
	).deletePrefix(keyPrefix);
	log.info({ keyPrefix }, "Storage prefix cleanup complete");
};

// The MCP tables keep an opaque user id with no foreign key to auth_user, so
// erasing a login user deletes their MCP rows by that id.
const mcpUserTables = [
	"mcp_session",
	"mcp_oauth_client",
	"mcp_oauth_refresh_token",
	"mcp_oauth_access_token",
	"mcp_oauth_consent",
	"mcp_device_code",
].map((name) => sqliteTable(name, { userId: text("user_id") }));

// The app, mail and search databases are opened once, on first use, and
// shared by every delete (the native binding loads there, hence async). Built
// lazily so a worker that never deletes does not open a database handle.
let storesPromise: Promise<SqliteStores> | undefined;

const getStores = (): Promise<SqliteStores> => {
	storesPromise ??= openSqliteDatabases(sqliteDatabasePathsFromEnv()).then(
		(databases) => syncStores(databases, BETTER_SQLITE3_LIMITS),
	);
	return storesPromise;
};

export const buildRelationalDeletionCapabilities =
	(): DeletionCapabilities => ({
		assertReady: async () => {},
		signOut: async (userId, log) => {
			const { app } = await getStores();
			await app.batch([
				...mcpUserTables.map((table) =>
					app.db.delete(table).where(eq(table.userId, userId)),
				),
				app.db.delete(auth_user).where(eq(auth_user.id, userId)),
			]);
			log.info({ userId }, "Auth user erased");
		},
		invalidateContent: async (contentPrefix, log) => {
			log.info(
				{ contentPrefix },
				"Content invalidation is a no-op on the relational backend; no CDN cache fronts /content",
			);
		},
		deleteStoragePrefix: (keyPrefix, log) =>
			deleteStoragePrefix(keyPrefix, log),
		cascadeDelete: async (entities, log) =>
			runDrizzleCascadeDelete(await getStores(), entities, log),
		eraseAccountConfig: async (accountConfigId, log) =>
			runDrizzleAccountConfigErase(await getStores(), accountConfigId, log),
	});
