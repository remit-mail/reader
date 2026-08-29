import type { CalendarObjectItem, PutCalendarObjectInput } from "../types.js";

export interface ICalendarObjectRepository {
	put(input: PutCalendarObjectInput): Promise<CalendarObjectItem>;
	get(
		calendarId: string,
		calendarObjectId: string,
	): Promise<CalendarObjectItem>;
	/**
	 * The resource under an id, or `null` when the collection does not hold it.
	 * `get` throws instead, which is right for a caller that already knows the
	 * resource exists; a request naming one is asking whether it does, and that
	 * is an answer rather than a fault.
	 */
	find(
		calendarId: string,
		calendarObjectId: string,
	): Promise<CalendarObjectItem | null>;
	delete(calendarId: string, calendarObjectId: string): Promise<void>;
	findByResourceName(
		calendarId: string,
		resourceName: string,
	): Promise<CalendarObjectItem | null>;
	/**
	 * The resource carrying an iCalendar UID, which is how a scheduling message
	 * or a calendar-query REPORT addresses an event — a client that has the UID
	 * generally does not have the resource name.
	 */
	findByUid(
		calendarId: string,
		icalUid: string,
	): Promise<CalendarObjectItem | null>;
	listByCalendar(calendarId: string): Promise<CalendarObjectItem[]>;
	/**
	 * The resources whose occurrence rows stop before `instant` — the series a
	 * range read has to expand for itself because the index does not reach that
	 * far. Narrow by construction: a resource that fits inside the expansion
	 * horizon carries no `expandedThrough` and never appears here, so a view of
	 * an ordinary calendar reads no iCalendar text at all.
	 */
	listIncompleteExpansions(
		calendarId: string,
		instant: string,
	): Promise<CalendarObjectItem[]>;
	/**
	 * Everything written to the collection after `syncSequence`, in change
	 * order — the read behind a WebDAV-Sync report. Exclusive of the token
	 * itself, so replaying a token returns only what the client has not seen.
	 */
	listChangedSince(
		calendarId: string,
		syncSequence: number,
	): Promise<CalendarObjectItem[]>;
}
