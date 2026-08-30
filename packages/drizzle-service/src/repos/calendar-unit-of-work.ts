import type {
	CalendarUnitOfWorkRepositories,
	ICalendarUnitOfWork,
} from "@remit/data-ports";
import type { Db } from "../db.js";
import { runInTransaction } from "../tx.js";
import { CalendarCollectionRepo } from "./calendar-collection.js";
import { CalendarEventIndexRepo } from "./calendar-event-index.js";
import { CalendarObjectRepo } from "./calendar-object.js";
import { CalendarSuggestionRepo } from "./calendar-suggestion.js";

type DB = Db<Record<string, unknown>>;

export class DrizzleCalendarUnitOfWork implements ICalendarUnitOfWork {
	constructor(private db: DB) {}

	transaction<T>(
		fn: (repos: CalendarUnitOfWorkRepositories) => Promise<T>,
	): Promise<T> {
		return runInTransaction(this.db, (tx) =>
			fn({
				calendarCollection: new CalendarCollectionRepo(tx as never),
				calendarObject: new CalendarObjectRepo(tx as never),
				calendarEventIndex: new CalendarEventIndexRepo(tx as never),
				calendarSuggestion: new CalendarSuggestionRepo(tx as never),
			}),
		);
	}
}
