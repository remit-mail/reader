import { EventDetail } from "@remit/ui";
import { CalendarDays } from "lucide-react";
import { useCalendarData } from "@/hooks/useCalendarData";
import { formatEventWhen } from "@/lib/calendar-format";
import { useCalendarAddress, useCalendarNavigation } from "@/routing";

/**
 * The event the address has open.
 *
 * A child route of the view, so the grid it was opened from stays matched
 * behind it and closing is a navigation up rather than a flag. Editing and
 * deleting arrive with the calendar API, and until then the header offers
 * neither — a control that leads nowhere is worse than no control.
 */
export interface CalendarEventPaneProps {
	calendarObjectId: string;
	/** One instance of a series, absent on the series itself. */
	recurrenceId?: string;
}

export function CalendarEventPane({
	calendarObjectId,
	recurrenceId,
}: CalendarEventPaneProps) {
	const { view, date, calendarIds } = useCalendarAddress();
	const { events, calendars } = useCalendarData({ view, date, calendarIds });
	const { closeEvent } = useCalendarNavigation();

	const event = events.find((candidate) => candidate.id === calendarObjectId);
	const calendar = calendars.find(
		(candidate) => candidate.id === event?.calendarId,
	);

	if (!event || !calendar) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 bg-surface p-8 text-center">
				<CalendarDays className="size-8 text-fg-subtle" aria-hidden="true" />
				<p className="text-sm font-medium text-fg">
					That event isn't on this week
				</p>
				<p className="max-w-xs text-sm text-fg-muted">
					The address names an event the calendar doesn't have here.
				</p>
				<button
					type="button"
					onClick={closeEvent}
					className="rounded-md border border-line px-2.5 py-1 text-sm font-medium text-fg outline-none hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-ring"
				>
					Back to the calendar
				</button>
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col bg-surface">
			{recurrenceId !== undefined && (
				<p className="shrink-0 border-b border-line bg-surface-sunken px-row-inset py-1.5 text-2xs uppercase tracking-wider text-fg-subtle">
					One occurrence of a repeating event
				</p>
			)}
			<EventDetail
				event={event}
				calendar={calendar}
				whenText={formatEventWhen(event)}
				onClose={closeEvent}
				className="min-h-0 flex-1"
			/>
		</div>
	);
}
