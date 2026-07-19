import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
	type CascadeDeleter,
	createCascadeDeleter,
	createSqliteCascadeDeleter,
} from "@remit/drizzle-service";
import type { Logger } from "@remit/logger-lambda";
import { env } from "expect-env";
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

// The Drizzle cascade deleter is opened once, on first use, and reused. On
// Postgres it binds to `PG_CONNECTION_URL`; on SQLite it opens the shared file
// at `SQLITE_DB_PATH` (the native binding loads there, hence async). Built
// lazily so the fanout worker — which signs out but never cascade-deletes —
// does not open a database handle it will not use.
let deleterPromise: Promise<CascadeDeleter> | undefined;

const buildDeleter = async (): Promise<CascadeDeleter> => {
	if (process.env.DATA_BACKEND === "sqlite") {
		return createSqliteCascadeDeleter(env.SQLITE_DB_PATH);
	}
	return createCascadeDeleter(env.PG_CONNECTION_URL);
};

const getDeleter = (): Promise<CascadeDeleter> => {
	if (!deleterPromise) deleterPromise = buildDeleter();
	return deleterPromise;
};

/**
 * The self-host stack's deletion capabilities (RFC 035/036).
 *
 * - `signOut`: no-op. Deleting the AccountConfig row severs the session's
 *   account→data resolution, and there is no federated session store to sign
 *   out of; better-auth session rows are owned by the auth service, outside this
 *   worker's data seam.
 * - `invalidateContent`: no-op. Caddy proxies `/content/*` straight to the
 *   backend with no response cache (`deploy/vps/caddy/routes.caddy`), so there
 *   is nothing to invalidate.
 * - `deleteStoragePrefix`: recursive filesystem removal.
 * - `cascadeDelete`: the Drizzle cascade over Postgres or SQLite. Message
 *   subtrees emit `message.removed` outbox rows the search-index worker relays.
 */
export const buildRelationalDeletionCapabilities =
	(): DeletionCapabilities => ({
		assertReady: async () => {},
		signOut: async (userId, log) => {
			log.info(
				{ userId },
				"Sign-out is a no-op on the relational backend; AccountConfig removal severs session data access",
			);
		},
		invalidateContent: async (contentPrefix, log) => {
			log.info(
				{ contentPrefix },
				"Content invalidation is a no-op on the relational backend; no CDN cache fronts /content",
			);
		},
		deleteStoragePrefix: (keyPrefix, log) =>
			deleteStoragePrefix(keyPrefix, log),
		cascadeDelete: async (entities, log) => {
			const deleter = await getDeleter();
			await deleter(entities, log);
		},
	});
