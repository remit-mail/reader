import type { CalendarDescriptor, CalendarEventData } from "@remit/ui";
import { EventDetail } from "@remit/ui";
import { CalendarDays } from "lucide-react";
import { formatEventWhen } from "@/lib/calendar-format";

/**
 * The event the address has open.
 *
 * Presentational, like the workspace beside it: the route resolves the event
 * and turns closing into a navigation, so this renders what it is handed and
 * nothing else. Editing and deleting arrive with the calendar API, and until
 * then the header offers neither — a control that leads nowhere is worse than
 * no control.
 */
export interface CalendarEventPaneProps {
	/** Absent when the address names an event the calendar does not have. */
	event: CalendarEventData | undefined;
	calendar: CalendarDescriptor | undefined;
	/** Whether the address names one occurrence rather than the series. */
	isOccurrence: boolean;
	onClose: () => void;
}

export function CalendarEventPane({
	event,
	calendar,
	isOccurrence,
	onClose,
}: CalendarEventPaneProps) {
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
					onClick={onClose}
					className="rounded-md border border-line px-2.5 py-1 text-sm font-medium text-fg outline-none hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-ring"
				>
					Back to the calendar
				</button>
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col bg-surface">
			{isOccurrence && (
				<p className="shrink-0 border-b border-line bg-surface-sunken px-row-inset py-1.5 text-2xs uppercase tracking-wider text-fg-subtle">
					One occurrence of a repeating event
				</p>
			)}
			<EventDetail
				event={event}
				calendar={calendar}
				whenText={formatEventWhen(event)}
				onClose={onClose}
				className="min-h-0 flex-1"
			/>
		</div>
	);
}
