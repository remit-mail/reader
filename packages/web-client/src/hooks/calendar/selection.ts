/**
 * Which calendars a surface is drawing, and how their occurrences become rows.
 *
 * Both readings of the calendar ask this and neither may answer it its own way:
 * the grid reads one window and the strip reads many, but "which calendars did
 * the address tick, and what does an occurrence look like once drawn" has one
 * answer, and a second copy of it drifts into the two surfaces disagreeing
 * about the same day.
 */
import type { RemitImapCalendarEventInstance } from "@remit/api-http-client/types.gen.ts";
import type {
	CalendarColorId,
	CalendarDescriptor,
	CalendarEventData,
} from "@remit/ui";
import { useMemo } from "react";
import {
	isDrawnInstance,
	toCalendarEventData,
	UNZONED_CALENDAR,
} from "./instance";
import { useCalendars } from "./useCalendars";

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

export interface CalendarSelection {
	calendars: CalendarDescriptor[];
	colorByCalendarId: Record<string, CalendarColorId>;
	timeZoneByCalendarId: Record<string, string>;
	/** Every calendar this address draws, resolved against the real ones. */
	shown: string[];
	/** What to ask the server for: empty where that is every calendar. */
	narrowed: string[];
	/** False while the tick list still has no real calendars to resolve against. */
	resolved: boolean;
	isLoading: boolean;
}

export function useCalendarSelection(
	calendarIds: readonly string[],
): CalendarSelection {
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

	return {
		calendars,
		colorByCalendarId,
		timeZoneByCalendarId,
		shown,
		narrowed,
		resolved,
		isLoading,
	};
}

/**
 * Occurrences as rows: the ones on a calendar being drawn, on the clock their
 * collection keeps. A collection with no zone of its own is sent as unzoned
 * rather than as the reader's — answering with the device's clock would rewrite
 * every time they saved by the difference between the two.
 */
export function useDrawnEvents(
	instances: readonly RemitImapCalendarEventInstance[],
	timeZoneByCalendarId: Record<string, string>,
	shown: readonly string[],
): CalendarEventData[] {
	const shownKey = shown.join(",");
	return useMemo(() => {
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
}
