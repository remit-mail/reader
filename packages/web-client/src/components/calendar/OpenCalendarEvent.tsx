import { CalendarEventPane } from "@/components/calendar/CalendarEventPane";
import { useCalendarData } from "@/hooks/useCalendarData";
import { useCalendarAddress, useCalendarNavigation } from "@/routing";

/**
 * The event the address names, resolved.
 *
 * The two event routes — the series and one of its occurrences — differ only in
 * what the address says, so the lookup and the way back live here once rather
 * than in each of them.
 */
export interface OpenCalendarEventProps {
	calendarObjectId: string;
	/** One occurrence of a series, absent on the series itself. */
	recurrenceId?: string;
}

export function OpenCalendarEvent({
	calendarObjectId,
	recurrenceId,
}: OpenCalendarEventProps) {
	const { view, date, calendarIds } = useCalendarAddress();
	const { events, calendars } = useCalendarData({ view, date, calendarIds });
	const { closeEvent } = useCalendarNavigation();

	const event = events.find((candidate) => candidate.id === calendarObjectId);
	const calendar = calendars.find(
		(candidate) => candidate.id === event?.calendarId,
	);

	return (
		<CalendarEventPane
			event={event}
			calendar={calendar}
			isOccurrence={recurrenceId !== undefined}
			onClose={closeEvent}
		/>
	);
}
