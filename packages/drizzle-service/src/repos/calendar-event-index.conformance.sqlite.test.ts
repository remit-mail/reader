import { calendarEventIndexRepositoryConformance } from "@remit/data-ports/conformance";
import { NODE_SQLITE_LIMITS } from "../bound-parameters.js";
import { syncStore } from "../databases.js";
import { NotFoundError } from "../error.js";
import { randomId } from "../id.js";
import { calendarEventIndexTable } from "../schema.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import { CalendarEventIndexRepo } from "./calendar-event-index.js";

let close: (() => Promise<void>) | undefined;

calendarEventIndexRepositoryConformance({
	async createRepository() {
		const { db, close: closeDb } = await createSqliteTestDb({
			calendarEventIndexes: calendarEventIndexTable,
		});
		close = closeDb;
		return new CalendarEventIndexRepo(
			syncStore(db, NODE_SQLITE_LIMITS, (work) => db.transaction(work)),
		);
	},
	teardown: async () => {
		await close?.();
	},
	makeId: () => randomId(),
	isNotFoundError: (error) => error instanceof NotFoundError,
});
