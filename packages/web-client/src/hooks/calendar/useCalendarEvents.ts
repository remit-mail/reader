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
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
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
export const CALENDAR_WINDOW_STALE_TIME = 5 * 60_000;

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

export interface CalendarEventWeeksResult {
	instances: RemitImapCalendarEventInstance[];
	/** Windows whose answer has not arrived, by their `from`. */
	pendingWindows: Set<string>;
	/** The first refusal any of them met. Null when they all succeeded. */
	error: unknown;
	refetch: () => void;
}

/**
 * Several windows at once, each fetched and cached on its own.
 *
 * This is what lets a surface hold a range wider than a single read may ask
 * for: the server refuses a window over a year, and one request that grows
 * every time the reader reaches an end eventually becomes that window and
 * replaces what is on screen with a refusal. A week per request has no such
 * ceiling — reaching an end adds a key rather than widening one — and because
 * the keys are the grid's own, dropping into the week grid and coming back out
 * draws from what the strip already fetched, and vice versa.
 *
 * Windows already held keep their entries while a new one is in flight, so
 * nothing on screen is given up to fetch what is beside it.
 */
export function useCalendarEventWeeks(
	windows: readonly CalendarWindow[],
	calendarIds: readonly string[],
	enabled: boolean,
): CalendarEventWeeksResult {
	const results = useQueries({
		queries: windows.map((window) => ({
			...calendarEventOperationsListCalendarEventsOptions(
				requestOptions({ ...window, calendarIds }),
			),
			meta: CALENDAR_READ_META,
			staleTime: CALENDAR_WINDOW_STALE_TIME,
			enabled,
		})),
	});

	const froms = windows.map((window) => window.from).join("|");
	const settled = results.map((result) => result.data);
	const pendingKey = results.map((result) => result.isPending).join("|");
	const firstError = results.find((result) => result.error)?.error ?? null;

	// biome-ignore lint/correctness/useExhaustiveDependencies: the joined keys stand for the per-window results, which are a new array every render
	const instances = useMemo(
		() => settled.flatMap((data) => data?.items ?? []),
		[froms, pendingKey],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: as above
	const pendingWindows = useMemo(() => {
		const pending = new Set<string>();
		windows.forEach((window, index) => {
			if (results[index]?.isPending) pending.add(window.from);
		});
		return pending;
	}, [froms, pendingKey]);

	return {
		instances,
		pendingWindows,
		error: firstError,
		refetch: () => {
			for (const result of results) {
				if (result.error) result.refetch();
			}
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
