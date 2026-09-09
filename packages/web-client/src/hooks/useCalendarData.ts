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
import {
	type CalendarInstanceRef,
	calendarWindow,
	readCalendarInstanceId,
	useCalendarEventWindow,
	useCalendarSelection,
	useDrawnEvents,
	usePrefetchAdjacentWindows,
} from "@/hooks/calendar";

export interface CalendarDataRequest {
	view: CalendarViewId;
	/** The day the view is centred on, `YYYY-MM-DD`. */
	date: string;
	/** The calendars the address has ticked; empty means every one of them. */
	calendarIds: readonly string[];
	/**
	 * False where the zoom on screen draws nothing from this window. The agenda
	 * rolls its own range a week at a time, so asking for this view's week as
	 * well would fetch a window nothing renders — and the address rewriting on
	 * every scroll would ask again, with its neighbours, all the way down.
	 */
	enabled?: boolean;
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

export function useCalendarData({
	view,
	date,
	calendarIds,
	enabled = true,
}: CalendarDataRequest): CalendarData {
	const {
		calendars,
		colorByCalendarId,
		timeZoneByCalendarId,
		shown,
		narrowed,
		resolved,
		isLoading,
	} = useCalendarSelection(calendarIds);

	const window = calendarWindow(view, date);
	const active = enabled && resolved;
	const events = useCalendarEventWindow({
		...window,
		calendarIds: narrowed,
		enabled: active,
	});
	usePrefetchAdjacentWindows(view, date, narrowed, active);

	const eventData = useDrawnEvents(
		events.instances,
		timeZoneByCalendarId,
		shown,
	);

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
