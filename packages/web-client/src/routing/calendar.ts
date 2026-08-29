import type { CalendarViewId } from "@remit/ui";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import {
	canonicalCalendarParams,
	isoDate,
	stepCalendarDate,
} from "@/lib/calendar-route";
import { useRetainOpenPanels } from "./fragment";

const VIEW_ROUTE = "/calendar/$view/$date" as const;

/** Which zoom the calendar is at, on which day, over which calendars. */
export interface CalendarAddress {
	view: CalendarViewId;
	/** `YYYY-MM-DD`. */
	date: string;
	/** The calendars ticked in the query; empty means every one of them. */
	calendarIds: readonly string[];
}

/**
 * The calendar the address names.
 *
 * The route canonicalises its own segments before anything mounts, so what
 * arrives here is always a view the ladder has and a day the calendar has —
 * the fallbacks below only cover the frame before the router has resolved
 * the params.
 */
export function useCalendarAddress(): CalendarAddress {
	const params = useParams({ from: VIEW_ROUTE, shouldThrow: false });
	const search = useSearch({ from: VIEW_ROUTE, shouldThrow: false });
	const view = params?.view ?? "";
	const date = params?.date ?? "";
	const calendarIds = search?.calendarId;
	return useMemo(() => {
		const canonical = canonicalCalendarParams(
			{ view, date },
			isoDate(new Date()),
		);
		return { ...canonical, calendarIds: calendarIds ?? [] };
	}, [view, date, calendarIds]);
}

/** The event the reading pane has open, and the instance of it, if any. */
export interface OpenCalendarEvent {
	calendarObjectId: string;
	/** One instance of a series; absent on the series itself. */
	recurrenceId: string | undefined;
}

export function useOpenCalendarEvent(): OpenCalendarEvent | undefined {
	const event = useParams({
		from: "/calendar/$view/$date/$calendarObjectId",
		shouldThrow: false,
	});
	const instance = useParams({
		from: "/calendar/$view/$date/$calendarObjectId/$recurrenceId",
		shouldThrow: false,
	});
	const calendarObjectId = event?.calendarObjectId;
	const recurrenceId = instance?.recurrenceId;
	return useMemo(
		() => (calendarObjectId ? { calendarObjectId, recurrenceId } : undefined),
		[calendarObjectId, recurrenceId],
	);
}

/** Whether the composer is up, which is a route rather than a flag. */
export function useIsWritingEvent(): boolean {
	const composer = useParams({
		from: "/calendar/$view/$date/new",
		shouldThrow: false,
	});
	return composer !== undefined;
}

export interface CalendarNavigation {
	/** Change zoom, keeping the day on screen. */
	goToView: (view: CalendarViewId) => void;
	/** The previous or next screenful, measured in the view's own unit. */
	step: (direction: -1 | 1) => void;
	/** Home, from every view and every distance away. */
	goToToday: () => void;
	/**
	 * One occurrence names the series it belongs to and the instance under it;
	 * a resource that does not recur names only itself.
	 */
	openEvent: (calendarObjectId: string, recurrenceId?: string) => void;
	closeEvent: () => void;
	openComposer: () => void;
}

/**
 * Every move the calendar makes, as an address.
 *
 * Prev, next, today and the zoom switch are navigations rather than state
 * changes, so the address always names what is on screen and a link to it
 * reopens exactly that. Each one carries the open panes across the way the nav
 * does, so the reader keeps their chrome moving through the week.
 */
export function useCalendarNavigation(): CalendarNavigation {
	const navigate = useNavigate();
	const retainPanels = useRetainOpenPanels();
	const { view, date } = useCalendarAddress();

	const goTo = useCallback(
		(params: { view: CalendarViewId; date: string }) => {
			navigate({
				to: VIEW_ROUTE,
				params,
				search: true,
				hash: retainPanels,
			});
		},
		[navigate, retainPanels],
	);

	return useMemo(
		() => ({
			goToView: (next: CalendarViewId) => goTo({ view: next, date }),
			step: (direction: -1 | 1) =>
				goTo({ view, date: stepCalendarDate(date, view, direction) }),
			goToToday: () => goTo({ view, date: isoDate(new Date()) }),
			openEvent: (calendarObjectId: string, recurrenceId?: string) =>
				recurrenceId === undefined || recurrenceId === ""
					? navigate({
							to: "/calendar/$view/$date/$calendarObjectId",
							params: { view, date, calendarObjectId },
							search: true,
							hash: retainPanels,
						})
					: navigate({
							to: "/calendar/$view/$date/$calendarObjectId/$recurrenceId",
							params: { view, date, calendarObjectId, recurrenceId },
							search: true,
							hash: retainPanels,
						}),
			closeEvent: () => goTo({ view, date }),
			openComposer: () =>
				navigate({
					to: "/calendar/$view/$date/new",
					params: { view, date },
					search: true,
					hash: retainPanels,
				}),
		}),
		[goTo, navigate, retainPanels, view, date],
	);
}
