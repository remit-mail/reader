/**
 * What the calendar surfaces read, and the only place they read it from.
 *
 * The seam is here, and not inside the grid, because the grid is presentational
 * and expands no recurrence of its own — the server returns instances and this
 * turns them into what the kit draws. Every caller keeps the call it makes.
 */
import type {
	CalendarColorId,
	CalendarDescriptor,
	CalendarEventData,
	CalendarViewId,
} from "@remit/ui";
import { useMemo } from "react";
import {
	type CalendarInstanceRef,
	calendarWindow,
	isDrawnInstance,
	readCalendarInstanceId,
	toCalendarEventData,
	UNZONED_CALENDAR,
	useCalendarEventWindow,
	useCalendars,
	usePrefetchAdjacentWindows,
} from "@/hooks/calendar";

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
	/** The zone each collection's times are read on — never the device's. */
	timeZoneByCalendarId: Record<string, string>;
	isLoading: boolean;
	/** A refusal the calendar renders itself. Null when the read succeeded. */
	error: unknown;
	retry: () => void;
	/** The resource and occurrence behind an event the grid selected. */
	instanceOf: (eventId: string) => CalendarInstanceRef;
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
	view,
	date,
	calendarIds,
}: CalendarDataRequest): CalendarData {
	const { calendars, colorByCalendarId, timeZoneByCalendarId, isLoading } =
		useCalendars();

	const shown = selectCalendarIds(calendars, calendarIds);
	// Asking for every calendar by name and asking for all of them are the same
	// question, so they are the same cache entry: the address ticking each one
	// off must not refetch the week the address ticking none already holds.
	const narrowed = shown.length === calendars.length ? [] : shown;
	// A tick list can only be resolved against calendars that have loaded, so a
	// narrowed address waits for them rather than asking about ids it cannot
	// know are real.
	const resolved = calendarIds.length === 0 || calendars.length > 0;

	const window = calendarWindow(view, date);
	const events = useCalendarEventWindow({
		...window,
		calendarIds: narrowed,
		enabled: resolved,
	});
	usePrefetchAdjacentWindows(view, date, narrowed, resolved);

	const shownKey = shown.join(",");
	const instances = events.instances;

	const eventData = useMemo(() => {
		const drawn = new Set(shownKey === "" ? [] : shownKey.split(","));
		return instances
			.filter(
				(instance) =>
					isDrawnInstance(instance) && drawn.has(instance.calendarId),
			)
			.map((instance) =>
				toCalendarEventData(
					instance,
					timeZoneByCalendarId[instance.calendarId] ?? UNZONED_CALENDAR,
				),
			);
	}, [instances, timeZoneByCalendarId, shownKey]);

	return {
		calendars,
		events: eventData,
		colorByCalendarId,
		timeZoneByCalendarId,
		isLoading: isLoading || events.isLoading,
		error: events.error,
		retry: events.refetch,
		instanceOf: readCalendarInstanceId,
	};
}
