import { calendarFeedTokenRepositoryConformance } from "@remit/data-ports/conformance";
import { NotFoundError } from "../error.js";
import { randomId } from "../id.js";
import { calendarFeedTokenTable } from "../schema.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import { CalendarFeedTokenRepo } from "./calendar-feed-token.js";

let close: (() => Promise<void>) | undefined;

calendarFeedTokenRepositoryConformance({
	async createRepository() {
		const { db, close: closeDb } = await createSqliteTestDb({
			calendarFeedTokens: calendarFeedTokenTable,
		});
		close = closeDb;
		return new CalendarFeedTokenRepo(db as never);
	},
	teardown: async () => {
		await close?.();
	},
	makeId: () => randomId(),
	isNotFoundError: (error) => error instanceof NotFoundError,
});
