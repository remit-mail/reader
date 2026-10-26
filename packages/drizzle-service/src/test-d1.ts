import { drizzle } from "drizzle-orm/d1";
import { Miniflare } from "miniflare";
import { asyncBatch } from "./batch.js";
import type { SqliteLimits } from "./bound-parameters.js";
import { syncStore } from "./databases.js";
import type { SqliteStore } from "./db.js";
import {
	type MigrationSet,
	migrationStatements,
} from "./test-shipped-sqlite-schema.js";
import { createShippedSqliteDb } from "./test-sqlite.js";
import type { OpenTestStores } from "./test-stores.js";

const CLOUDFLARE_LIMITS: SqliteLimits = { maxBoundParameters: 100 };

/** One in-process D1 database migrated with a committed set, written through `db.batch()`. */
export const openD1TestStore = async (
	set: MigrationSet,
): Promise<{
	store: SqliteStore<Record<string, unknown>>;
	close: () => Promise<void>;
}> => {
	const miniflare = new Miniflare({
		modules: true,
		script: "export default {};",
		d1Databases: { DB: set },
	});
	const d1 = await miniflare.getD1Database("DB");
	const statements = migrationStatements(set).filter(
		(statement) => statement.trim() !== "",
	);
	await d1.batch(statements.map((statement) => d1.prepare(statement)));
	const db = drizzle(d1);
	return {
		store: { db, batch: asyncBatch(db), ...CLOUDFLARE_LIMITS },
		close: () => miniflare.dispose(),
	};
};

/**
 * The stores a Cloudflare deployment runs the app repositories on: the app
 * database on an in-process D1, migrated with the committed app set, written
 * through `db.batch()`. The mail and search sets stay on a synchronous handle,
 * as they do in the tenant mail Durable Object.
 */
export const openD1TestStores: OpenTestStores = async () => {
	const app = await openD1TestStore("app");
	const shipped = createShippedSqliteDb();
	const local = syncStore(shipped.db, CLOUDFLARE_LIMITS);
	return {
		stores: { app: app.store, mail: local, search: local },
		close: async () => {
			shipped.close();
			await app.close();
		},
	};
};
