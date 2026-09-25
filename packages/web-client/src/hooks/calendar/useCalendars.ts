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
	/**
	 * Where an accepted invitation lands: the collection the account was
	 * provisioned with, or the first one when that is gone. `""` until the
	 * listing has answered.
	 */
	defaultCalendarId: string;
	isLoading: boolean;
	/** Why the listing could not be read; null when it was. */
	error: unknown;
}

export function useCalendars(): CalendarsResult {
	const { data, isLoading, error } = useQuery(
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
			defaultCalendarId:
				(items.find((item) => item.source === "Default") ?? items[0])
					?.calendarId ?? "",
			isLoading,
			error: error ?? null,
		};
	}, [data, isLoading, error]);
}
