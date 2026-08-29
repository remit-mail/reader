/**
 * Expanded occurrences over a window.
 *
 * The server does the expansion, so nothing here reads an RRULE: a week grid
 * and a day strip draw the same instances because they asked the same question,
 * not because they each ran the same maths.
 *
 * The query is keyed by the window rather than by the day the address names, so
 * every day inside a week shares one cache entry and stepping back to a week
 * already read draws from it. The window either side is prefetched, which is
 * what makes prev and next land on a full calendar instead of a spinner.
 */
import { calendarEventOperationsListCalendarEventsOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { Options } from "@remit/api-http-client/sdk.gen.ts";
import type {
	CalendarEventOperationsListCalendarEventsData,
	RemitImapCalendarEventInstance,
} from "@remit/api-http-client/types.gen.ts";
import type { CalendarViewId } from "@remit/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { stepCalendarDate } from "@/lib/calendar-route";
import { softErrorStatuses } from "@/lib/error-classifier";
import { type CalendarWindow, calendarWindow } from "./window";

/**
 * The refusals this surface answers itself: a window the server will not read,
 * and a calendar the address names that is no longer there. Everything else —
 * a lapsed session above all — escalates.
 */
const CALENDAR_READ_META = softErrorStatuses(400, 404);

/**
 * How long a window stays worth reusing.
 *
 * Explicit rather than inherited, because prefetching is the whole point: a
 * warmed week that is already stale by the time the reader steps onto it is
 * fetched twice and the step waits anyway. Nothing here goes out of date on a
 * timer — every write invalidates the windows it touched — so this only needs
 * to outlast the reader moving back and forth across a few weeks.
 */
const CALENDAR_WINDOW_STALE_TIME = 5 * 60_000;

export interface CalendarEventWindowRequest extends CalendarWindow {
	/** Empty asks about every calendar the account holds. */
	calendarIds: readonly string[];
	/** False while the tick list is still being resolved against real calendars. */
	enabled?: boolean;
}

export interface CalendarEventWindowResult {
	instances: RemitImapCalendarEventInstance[];
	isLoading: boolean;
	/** A refusal this surface renders inline. Null when the read succeeded. */
	error: unknown;
	refetch: () => void;
}

const requestOptions = ({
	from,
	to,
	calendarIds,
}: CalendarEventWindowRequest): Options<CalendarEventOperationsListCalendarEventsData> => ({
	query:
		calendarIds.length === 0
			? { from, to }
			: { from, to, calendarId: [...calendarIds] },
});

/** One window, asked for once however many surfaces are drawing it. */
export function useCalendarEventWindow(
	request: CalendarEventWindowRequest,
): CalendarEventWindowResult {
	const { data, isLoading, error, refetch } = useQuery({
		...calendarEventOperationsListCalendarEventsOptions(
			requestOptions(request),
		),
		meta: CALENDAR_READ_META,
		staleTime: CALENDAR_WINDOW_STALE_TIME,
		enabled: request.enabled ?? true,
	});

	return {
		instances: data?.items ?? [],
		isLoading,
		error,
		refetch: () => {
			refetch();
		},
	};
}

/**
 * The windows either side of the one on screen, warmed while the reader is
 * looking at this one. A step is a navigation, and a navigation that has to
 * wait for a request reads as the calendar being slow rather than as the week
 * being fetched.
 */
export function usePrefetchAdjacentWindows(
	view: CalendarViewId,
	date: string,
	calendarIds: readonly string[],
	enabled: boolean,
): void {
	const queryClient = useQueryClient();
	const key = [...calendarIds].join(",");

	useEffect(() => {
		if (!enabled) return;
		const ids = key === "" ? [] : key.split(",");
		for (const direction of [-1, 1] as const) {
			const neighbour = calendarWindow(
				view,
				stepCalendarDate(date, view, direction),
			);
			void queryClient.prefetchQuery({
				...calendarEventOperationsListCalendarEventsOptions(
					requestOptions({ ...neighbour, calendarIds: ids }),
				),
				staleTime: CALENDAR_WINDOW_STALE_TIME,
			});
		}
	}, [queryClient, view, date, key, enabled]);
}
