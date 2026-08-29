/**
 * What the calendar surfaces read, and the only place they read it from.
 *
 * The body is fixture data until the REST layer lands: stage A.3 swaps it for
 * `GET /calendars` and `GET /calendar-events` over the range the view asks
 * for, and every caller keeps the call it already makes. The seam is here, and
 * not inside the grid, because the grid is presentational and expands no
 * recurrence of its own — the server returns instances.
 */
import type {
	CalendarColorId,
	CalendarDescriptor,
	CalendarEventData,
	CalendarViewId,
} from "@remit/ui";
import { useMemo } from "react";
import {
	fixtureCalendars,
	fixtureColorByCalendarId,
	fixtureEventsAround,
} from "@/lib/calendar-fixtures";

export interface CalendarDataRequest {
	view: CalendarViewId;
	/** The day the view is centred on, `YYYY-MM-DD`. */
	date: string;
	/** The calendars the address has ticked; empty means every one of them. */
	calendarIds: readonly string[];
}

export interface CalendarData {
	calendars: CalendarDescriptor[];
	events: CalendarEventData[];
	colorByCalendarId: Record<string, CalendarColorId>;
	isLoading: boolean;
}

/**
 * The calendars a request is asking about. An empty tick list is every
 * calendar rather than none: a reader who has ticked nothing off is looking at
 * all of them, and a URL naming a calendar that no longer exists shows the
 * rest instead of an empty week.
 */
export function selectCalendarIds(
	calendars: readonly CalendarDescriptor[],
	ticked: readonly string[],
): string[] {
	const known = calendars.map((calendar) => calendar.id);
	if (ticked.length === 0) return known;
	const wanted = new Set(ticked);
	const shown = known.filter((id) => wanted.has(id));
	return shown.length === 0 ? known : shown;
}

export function useCalendarData({
	date,
	calendarIds,
}: CalendarDataRequest): CalendarData {
	const key = [...calendarIds].join(",");
	return useMemo(() => {
		const ticked = key === "" ? [] : key.split(",");
		const shown = new Set(selectCalendarIds(fixtureCalendars, ticked));
		return {
			calendars: fixtureCalendars,
			events: fixtureEventsAround(date).filter((event) =>
				shown.has(event.calendarId),
			),
			colorByCalendarId: fixtureColorByCalendarId,
			isLoading: false,
		};
	}, [date, key]);
}
