import { calendarObjectRepositoryConformance } from "@remit/data-ports/conformance";
import { NotFoundError } from "../error.js";
import { randomId } from "../id.js";
import { calendarObjectTable } from "../schema.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import { CalendarObjectRepo } from "./calendar-object.js";

let close: (() => Promise<void>) | undefined;

calendarObjectRepositoryConformance({
	async createRepository() {
		const { db, close: closeDb } = await createSqliteTestDb({
			calendarObjects: calendarObjectTable,
		});
		close = closeDb;
		return new CalendarObjectRepo(db as never);
	},
	teardown: async () => {
		await close?.();
	},
	makeId: () => randomId(),
	isNotFoundError: (error) => error instanceof NotFoundError,
});
