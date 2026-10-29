import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
	BETTER_SQLITE3_LIMITS,
	eraseAuthUserOf,
	openSqliteDatabases,
	runDrizzleAccountConfigErase,
	runDrizzleCascadeDelete,
	type SqliteStores,
	sqliteDatabasePathsFromEnv,
	syncStores,
} from "@remit/drizzle-service";
import type { Logger } from "@remit/logger";
import type { DeletionCapabilities } from "./deletion-capabilities.js";

// Mirrors `@remit/storage-service`'s filesystem-backend default: bodies
// live under `STORAGE_LOCAL_PATH` (`.remit/storage` when unset). The cascade
// deletes the same `accounts/{accountConfigId}/…` key prefixes the S3 backend
// would, translated to a recursive directory removal.
const storageBasePath = (): string =>
	process.env.STORAGE_LOCAL_PATH ?? ".remit/storage";

/**
 * Recursively remove every stored object under a key prefix. Replay-safe:
 * `force: true` swallows a missing directory (ENOENT), matching the S3 backend's
 * "delete on missing keys is a 200" idempotency.
 */
const deleteStoragePrefix = async (
	keyPrefix: string,
	log: Logger,
): Promise<void> => {
	const target = join(storageBasePath(), keyPrefix);
	await rm(target, { recursive: true, force: true });
	log.info({ keyPrefix, target }, "Filesystem storage prefix cleanup complete");
};

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

/**
 * The self-host stack's deletion capabilities (RFC 035/036).
 *
 * - `signOut`: deletes the better-auth login user from the app database,
 *   which cascades to its sessions. An AccountConfig's `userId` is its own id.
 * - `invalidateContent`: no-op. Caddy proxies `/content/*` straight to the
 *   backend with no response cache (`deploy/vps/caddy/routes.caddy`), so there
 *   is nothing to invalidate.
 * - `deleteStoragePrefix`: recursive filesystem removal.
 * - `cascadeDelete`: the Drizzle cascade over SQLite.
 * - `eraseAccountConfig`: one keyed delete per table over SQLite.
 */
export const buildRelationalDeletionCapabilities =
	(): DeletionCapabilities => ({
		assertReady: async () => {},
		signOut: async (userId, log) =>
			eraseAuthUserOf((await getStores()).app, userId, log),
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
