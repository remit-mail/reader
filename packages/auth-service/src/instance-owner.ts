import { eq } from "drizzle-orm";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { DataConnectionConfig } from "./config.js";
import { resolveDataConnectionConfig } from "./config.js";
import { auth_user as auth_user_pg } from "./schema/auth-schema.js";
import { auth_user as auth_user_sqlite } from "./schema/auth-schema-sqlite.js";
import { instance_owner as instance_owner_pg } from "./schema/meta-schema.js";
import { instance_owner as instance_owner_sqlite } from "./schema/meta-schema-sqlite.js";

const OWNER_ROW_ID = 1;

export interface InstanceOwnerStore {
	/**
	 * Attempt to claim ownership for `userId`. A no-op once any row exists —
	 * the singleton row's primary key is the conditional write that lets
	 * concurrent first registrations race without both winning.
	 */
	claimIfUnclaimed(userId: string): Promise<void>;
	/**
	 * `ownerEmail`, when given, is `REMIT_OWNER_EMAIL` resolved to a user and
	 * compared directly — the stored claim is never consulted, so an email
	 * with no matching account makes every caller a non-owner.
	 */
	isOwner(userId: string, ownerEmail?: string): Promise<boolean>;
	close(): Promise<void>;
}

const buildPgStore = (connectionString: string): InstanceOwnerStore => {
	const pool = new pg.Pool({ connectionString });
	const db = drizzlePg(pool);

	return {
		async claimIfUnclaimed(userId) {
			await db
				.insert(instance_owner_pg)
				.values({ id: OWNER_ROW_ID, userId })
				.onConflictDoNothing();
		},
		async isOwner(userId, ownerEmail) {
			if (ownerEmail) {
				const [user] = await db
					.select({ id: auth_user_pg.id })
					.from(auth_user_pg)
					.where(eq(auth_user_pg.email, ownerEmail.toLowerCase()));
				return user?.id === userId;
			}
			const [row] = await db
				.select({ userId: instance_owner_pg.userId })
				.from(instance_owner_pg)
				.where(eq(instance_owner_pg.id, OWNER_ROW_ID));
			return row?.userId === userId;
		},
		async close() {
			await pool.end();
		},
	};
};

const buildSqliteStore = async (
	connectionString: string,
): Promise<InstanceOwnerStore> => {
	const { default: Database } = await import("better-sqlite3");
	const { drizzle } = await import("drizzle-orm/better-sqlite3");
	const sqlite = new Database(connectionString);
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("busy_timeout = 5000");
	const db = drizzle(sqlite);

	return {
		async claimIfUnclaimed(userId) {
			await db
				.insert(instance_owner_sqlite)
				.values({ id: OWNER_ROW_ID, userId })
				.onConflictDoNothing();
		},
		async isOwner(userId, ownerEmail) {
			if (ownerEmail) {
				const [user] = await db
					.select({ id: auth_user_sqlite.id })
					.from(auth_user_sqlite)
					.where(eq(auth_user_sqlite.email, ownerEmail.toLowerCase()));
				return user?.id === userId;
			}
			const [row] = await db
				.select({ userId: instance_owner_sqlite.userId })
				.from(instance_owner_sqlite)
				.where(eq(instance_owner_sqlite.id, OWNER_ROW_ID));
			return row?.userId === userId;
		},
		async close() {
			sqlite.close();
		},
	};
};

export const createInstanceOwnerStore = (
	config: DataConnectionConfig,
): Promise<InstanceOwnerStore> =>
	config.provider === "sqlite"
		? buildSqliteStore(config.connectionString)
		: Promise.resolve(buildPgStore(config.connectionString));

let defaultStore: Promise<InstanceOwnerStore> | null = null;

const getDefaultStore = (): Promise<InstanceOwnerStore> => {
	if (!defaultStore) {
		defaultStore = createInstanceOwnerStore(resolveDataConnectionConfig());
	}
	return defaultStore;
};

/** Test-only override for the memoized default store. Pass null to reset. */
export const _setInstanceOwnerStoreForTest = (
	store: InstanceOwnerStore | null,
): void => {
	defaultStore = store ? Promise.resolve(store) : null;
};

/**
 * Whether `userId` may trigger a standalone self-update (RFC 037 D8). Set
 * `REMIT_OWNER_EMAIL` overrides the stored claim entirely, including when it
 * names an account other than the one that claimed ownership.
 */
export const isInstanceOwner = async (userId: string): Promise<boolean> => {
	const store = await getDefaultStore();
	const ownerEmail = process.env.REMIT_OWNER_EMAIL?.trim();
	return store.isOwner(userId, ownerEmail || undefined);
};
