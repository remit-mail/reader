import type {
	CalendarEventIndexItem,
	CalendarOccurrenceInput,
} from "../types.js";

export interface ICalendarEventIndexRepository {
	/**
	 * Replaces every occurrence row of one resource with `occurrences`. Whole
	 * replacement rather than a merge: an edit that shortens a series must
	 * remove the occurrences it dropped, and a diff would leave them behind as
	 * events the calendar view still shows but the resource no longer has.
	 */
	replaceForObject(
		calendarId: string,
		calendarObjectId: string,
		occurrences: CalendarOccurrenceInput[],
	): Promise<void>;
	deleteForObject(calendarId: string, calendarObjectId: string): Promise<void>;
	listForObject(
		calendarId: string,
		calendarObjectId: string,
	): Promise<CalendarEventIndexItem[]>;
	/**
	 * Occurrences starting within `[startAt, endAt)`, in start order — the
	 * calendar-view read. Bounded by start rather than by overlap: an
	 * occurrence that began before the window and runs into it is not returned,
	 * so a caller that must show those widens the window by its longest event.
	 */
	listByStartRange(
		calendarId: string,
		startAt: string,
		endAt: string,
	): Promise<CalendarEventIndexItem[]>;
}
