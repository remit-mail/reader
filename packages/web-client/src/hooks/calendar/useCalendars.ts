/**
 * The calendars the account holds.
 *
 * The listing provisions a default collection on first read, so this never
 * comes back empty for a working account and no surface has to know how a
 * calendar gets made. It carries no `softError` meta: a session that has lapsed
 * escalates to the signed-out state rather than drawing an empty week, which is
 * indistinguishable from a week with nothing in it.
 */
import { calendarOperationsListCalendarsOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { CalendarColorId, CalendarDescriptor } from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { toCalendarDescriptor } from "./instance";

export interface CalendarsResult {
	calendars: CalendarDescriptor[];
	colorByCalendarId: Record<string, CalendarColorId>;
	/** The zone each collection's floating times are read in. */
	timeZoneByCalendarId: Record<string, string>;
	isLoading: boolean;
}

export function useCalendars(): CalendarsResult {
	const { data, isLoading } = useQuery(
		calendarOperationsListCalendarsOptions(),
	);

	return useMemo(() => {
		const items = data?.items ?? [];
		const calendars = items.map(toCalendarDescriptor);
		return {
			calendars,
			colorByCalendarId: Object.fromEntries(
				calendars.map((calendar) => [calendar.id, calendar.color]),
			),
			timeZoneByCalendarId: Object.fromEntries(
				items.map((item) => [item.calendarId, item.timezone]),
			),
			isLoading,
		};
	}, [data, isLoading]);
}
