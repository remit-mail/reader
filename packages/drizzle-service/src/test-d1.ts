import { drizzle } from "drizzle-orm/d1";
import { Miniflare } from "miniflare";
import { asyncBatch } from "./batch.js";
import { syncStore } from "./databases.js";
import { migrationStatements } from "./test-shipped-sqlite-schema.js";
import { createShippedSqliteDb } from "./test-sqlite.js";
import type { OpenTestStores } from "./test-stores.js";

/**
 * The stores a Cloudflare deployment runs the app repositories on: the app
 * database on an in-process D1, migrated with the committed app set, written
 * through `db.batch()`. The mail and search sets stay on a synchronous handle,
 * as they do in the tenant mail Durable Object.
 */
export const openD1TestStores: OpenTestStores = async () => {
	const miniflare = new Miniflare({
		modules: true,
		script: "export default {};",
		d1Databases: { APP: "app" },
	});
	const d1 = await miniflare.getD1Database("APP");
	const statements = migrationStatements("app").filter(
		(statement) => statement.trim() !== "",
	);
	await d1.batch(statements.map((statement) => d1.prepare(statement)));
	const app = drizzle(d1);
	const shipped = createShippedSqliteDb();
	const local = syncStore(shipped.db);
	return {
		stores: {
			app: { db: app, batch: asyncBatch(app) },
			mail: local,
			search: local,
		},
		close: async () => {
			shipped.close();
			await miniflare.dispose();
		},
	};
};
