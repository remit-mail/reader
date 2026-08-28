import type { CalendarObjectItem, PutCalendarObjectInput } from "../types.js";

export interface ICalendarObjectRepository {
	put(input: PutCalendarObjectInput): Promise<CalendarObjectItem>;
	get(
		calendarId: string,
		calendarObjectId: string,
	): Promise<CalendarObjectItem>;
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
	 * Everything written to the collection after `syncSequence`, in change
	 * order — the read behind a WebDAV-Sync report. Exclusive of the token
	 * itself, so replaying a token returns only what the client has not seen.
	 */
	listChangedSince(
		calendarId: string,
		syncSequence: number,
	): Promise<CalendarObjectItem[]>;
}
