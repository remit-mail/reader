import type { CalendarTaskItem, PutCalendarTaskInput } from "../types.js";

/**
 * The tasks of `VtodoOnly` collections. Every write is one row, so there is no
 * write set: a task has no occurrence rows and no sync sequence to keep in step.
 */
export interface ICalendarTaskRepository {
	put(input: PutCalendarTaskInput): Promise<CalendarTaskItem>;
	find(
		calendarId: string,
		calendarTaskId: string,
	): Promise<CalendarTaskItem | null>;
	delete(calendarId: string, calendarTaskId: string): Promise<void>;
	/** Tasks due within `[fromAt, toAt)`, UTC instants, in due order. */
	listByDueRange(
		calendarId: string,
		fromAt: string,
		toAt: string,
	): Promise<CalendarTaskItem[]>;
	deleteByCalendar(calendarId: string): Promise<void>;
}
