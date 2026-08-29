import type {
	CalendarCollectionItem,
	CreateCalendarCollectionInput,
	UpdateCalendarCollectionInput,
} from "../types.js";

export interface ICalendarCollectionRepository {
	/**
	 * Writes the collection under its derived `calendarId`. Provisioning the
	 * same `(accountConfigId, urlSegment)` twice returns the existing row rather
	 * than a second one, so first-use provisioning is safe to run on every
	 * request without a prior read.
	 */
	create(input: CreateCalendarCollectionInput): Promise<CalendarCollectionItem>;
	/**
	 * Writes the collection, or answers `null` when its `urlSegment` is already
	 * taken in this account config.
	 *
	 * The distinction from `create` is who asked. Provisioning wants the row
	 * whoever got there first wrote; a person naming a calendar wants to be told
	 * the name is taken, and handing them somebody else's calendar instead is a
	 * silent merge of two things they meant to keep apart.
	 */
	createExclusive(
		input: CreateCalendarCollectionInput,
	): Promise<CalendarCollectionItem | null>;
	get(
		accountConfigId: string,
		calendarId: string,
	): Promise<CalendarCollectionItem>;
	update(
		accountConfigId: string,
		calendarId: string,
		input: UpdateCalendarCollectionInput,
	): Promise<CalendarCollectionItem>;
	delete(accountConfigId: string, calendarId: string): Promise<void>;
	listByAccountConfig(
		accountConfigId: string,
	): Promise<CalendarCollectionItem[]>;
	findByUrlSegment(
		accountConfigId: string,
		urlSegment: string,
	): Promise<CalendarCollectionItem | null>;
	/**
	 * Advances the collection's change counter by one and returns the new value,
	 * which the caller stamps on the object it just wrote. Atomic with respect
	 * to concurrent writers: a read-then-write here would hand two writers the
	 * same sequence and lose one of them from every later sync report.
	 */
	bumpSyncSequence(
		accountConfigId: string,
		calendarId: string,
	): Promise<number>;
}
