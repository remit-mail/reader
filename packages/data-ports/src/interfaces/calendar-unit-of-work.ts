import type { ICalendarCollectionRepository } from "./calendar-collection.js";
import type { ICalendarEventIndexRepository } from "./calendar-event-index.js";
import type { ICalendarFeedTokenRepository } from "./calendar-feed-token.js";
import type { ICalendarObjectRepository } from "./calendar-object.js";
import type { ICalendarSuggestionRepository } from "./calendar-suggestion.js";

/**
 * The repositories one calendar write set touches, bound to a single unit of
 * work.
 */
export interface CalendarUnitOfWorkRepositories {
	calendarCollection: ICalendarCollectionRepository;
	calendarObject: ICalendarObjectRepository;
	calendarEventIndex: ICalendarEventIndexRepository;
	/**
	 * Present so accepting a suggestion settles the card in the same unit that
	 * writes the resource (issue #1033). The two are one fact: a card still
	 * asking with the event already in the calendar, or a card marked accepted
	 * with no event behind it, is a state nothing later can repair.
	 */
	calendarSuggestion: ICalendarSuggestionRepository;
	/**
	 * Present so removing a calendar takes its feed address with it (issue
	 * #1067). A token row outliving its collection is a credential pointing at
	 * nothing — it answers 404, but nobody can see it to revoke it, and a later
	 * calendar under the same derived id would inherit it.
	 */
	calendarFeedToken: ICalendarFeedTokenRepository;
}

/**
 * Runs a calendar write set as one atomic unit (issue #15). Writing a resource
 * is three writes — the object, its replaced occurrence rows, and the
 * collection's sequence bump — and none of them is meaningful without the
 * others: an object with stale occurrences is a calendar showing events the
 * resource no longer has, and an object written without the bump is a change no
 * sync report will ever hand a client.
 *
 * A throw rolls the whole set back. Backends without cross-entity transactions
 * supply a pass-through implementation that runs the callback against the plain
 * repositories.
 */
export interface ICalendarUnitOfWork {
	transaction<T>(
		fn: (repos: CalendarUnitOfWorkRepositories) => Promise<T>,
	): Promise<T>;
}
