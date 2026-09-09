import { calendarSuggestionRepositoryConformance } from "@remit/data-ports/conformance";
import { NotFoundError } from "../error.js";
import { randomId } from "../id.js";
import { calendarSuggestionTable } from "../schema.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import { CalendarSuggestionRepo } from "./calendar-suggestion.js";

let close: (() => Promise<void>) | undefined;

calendarSuggestionRepositoryConformance({
	async createRepository() {
		const { db, close: closeDb } = await createSqliteTestDb({
			calendarSuggestions: calendarSuggestionTable,
		});
		close = closeDb;
		return new CalendarSuggestionRepo(db as never);
	},
	teardown: async () => {
		await close?.();
	},
	makeId: () => randomId(),
	isNotFoundError: (error) => error instanceof NotFoundError,
});
