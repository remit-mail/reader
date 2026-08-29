import { calendarCollectionRepositoryConformance } from "@remit/data-ports/conformance";
import { NotFoundError } from "../error.js";
import { randomId } from "../id.js";
import { calendarTable } from "../schema.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import { CalendarCollectionRepo } from "./calendar-collection.js";

let close: (() => Promise<void>) | undefined;

calendarCollectionRepositoryConformance({
	async createRepository() {
		const { db, close: closeDb } = await createSqliteTestDb({
			calendars: calendarTable,
		});
		close = closeDb;
		return new CalendarCollectionRepo(db as never);
	},
	teardown: async () => {
		await close?.();
	},
	makeId: () => randomId(),
	isNotFoundError: (error) => error instanceof NotFoundError,
});
