import { type SqliteStores, syncStores } from "./databases.js";
import {
	calendarEventIndexTable,
	calendarObjectTable,
	calendarTable,
} from "./schema.js";
import { createTestDb } from "./test-db.js";
import { createSqliteTestDb } from "./test-db-sqlite.js";

/** The stores a repository suite runs against, opened once per test file. */
export type OpenTestStores = () => Promise<{
	stores: SqliteStores;
	close: () => Promise<void>;
}>;

/** The whole schema on one in-memory better-sqlite3 handle that plays all three databases. */
export const openSqliteTestStores: OpenTestStores = async () => {
	const { db, close } = await createTestDb();
	return { stores: syncStores({ app: db, mail: db, search: db }), close };
};

/** The three calendar tables alone on one in-memory better-sqlite3 handle. */
export const openCalendarSqliteTestStores: OpenTestStores = async () => {
	const { db, close } = await createSqliteTestDb({
		calendars: calendarTable,
		calendarObjects: calendarObjectTable,
		calendarEventIndexes: calendarEventIndexTable,
	});
	return { stores: syncStores({ app: db, mail: db, search: db }), close };
};
