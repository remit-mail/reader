/**
 * What the span a draft names runs into, across every calendar the reader
 * holds — so the editor says so before Save rather than the grid after it.
 *
 * Read on the weeks from the draft's first day through its last, which for a
 * single-day draft is the grid's own cache entry, and measured by the same rule the invitation card uses. Undefined
 * while there is no span to check (all day, a time missing, an end not after
 * the start) or no answer to
 * check it against: drawing "nothing else is booked" over a read that has not
 * landed is a claim, not a delay.
 */
import {
	type CalendarClash,
	type CalendarEventData,
	clashesWith,
	type EventDraft,
} from "@remit/ui";
import { useMemo } from "react";
import { formatEventWhen } from "@/lib/calendar-format";
import {
	deviceTimeZone,
	isDrawnInstance,
	toCalendarEventData,
	UNZONED_CALENDAR,
} from "./instance";
import { useCalendarEventWindow } from "./useCalendarEvents";
import { useCalendars } from "./useCalendars";
import { type CalendarWindow, calendarWindow, isoAtInZone } from "./window";

const EVERY_CALENDAR: readonly string[] = [];
const NO_WINDOW: CalendarWindow = { from: "", to: "" };

export function useDraftClashes(
	draft: EventDraft,
	/** The resource being edited, which never clashes with itself. */
	calendarObjectId = "",
): CalendarClash[] | undefined {
	const { timeZoneByCalendarId } = useCalendars();
	const checkable =
		draft.date !== "" &&
		!draft.allDay &&
		draft.endDate !== "" &&
		draft.startTime !== "" &&
		draft.endTime !== "" &&
		`${draft.endDate}T${draft.endTime}` > `${draft.date}T${draft.startTime}`;
	const { instances, isLoading, error } = useCalendarEventWindow({
		...(checkable
			? {
					from: calendarWindow("week", draft.date).from,
					to: calendarWindow("week", draft.endDate).to,
				}
			: NO_WINDOW),
		calendarIds: EVERY_CALENDAR,
		enabled: checkable,
	});

	const zone = deviceTimeZone();

	return useMemo(() => {
		if (!checkable || isLoading || error) return undefined;
		const start = isoAtInZone(draft.date, draft.startTime, zone);
		const end = isoAtInZone(draft.endDate, draft.endTime, zone);
		const others: CalendarEventData[] = instances
			.filter(
				(instance) =>
					isDrawnInstance(instance) &&
					instance.calendarObjectId !== calendarObjectId,
			)
			.map((instance) =>
				toCalendarEventData(
					instance,
					timeZoneByCalendarId[instance.calendarId] ?? UNZONED_CALENDAR,
					zone,
				),
			);
		return clashesWith({ start, end }, others).map((event) => ({
			id: event.id,
			label: `${event.title}, ${formatEventWhen(event)}`,
		}));
	}, [
		checkable,
		isLoading,
		error,
		draft.date,
		draft.endDate,
		draft.startTime,
		draft.endTime,
		zone,
		instances,
		calendarObjectId,
		timeZoneByCalendarId,
	]);
}
