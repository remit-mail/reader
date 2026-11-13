import { NODE_SQLITE_LIMITS } from "./bound-parameters.js";
import { type SqliteStores, syncStores } from "./databases.js";
import {
	calendarEventIndexTable,
	calendarObjectTable,
	calendarTable,
} from "./schema.js";
import { createTestDb } from "./test-db.js";
import { createSqliteTestDb } from "./test-db-sqlite.js";
import { sharedDatabases } from "./test-sqlite.js";

/** The stores a repository suite runs against, opened once per test file. */
export type OpenTestStores = () => Promise<{
	stores: SqliteStores;
	close: () => Promise<void>;
}>;

/** The whole schema on one in-memory node:sqlite handle that plays all three databases. */
export const openSqliteTestStores: OpenTestStores = async () => {
	const { db, immediate, close } = await createTestDb();
	return {
		stores: syncStores(sharedDatabases({ db, immediate }), NODE_SQLITE_LIMITS),
		close,
	};
};

/** The three calendar tables alone on one in-memory node:sqlite handle. */
export const openCalendarSqliteTestStores: OpenTestStores = async () => {
	const { db, immediate, close } = await createSqliteTestDb({
		calendars: calendarTable,
		calendarObjects: calendarObjectTable,
		calendarEventIndexes: calendarEventIndexTable,
	});
	return {
		stores: syncStores(sharedDatabases({ db, immediate }), NODE_SQLITE_LIMITS),
		close,
	};
};
