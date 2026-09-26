import type { CalendarDescriptor, CalendarEventData } from "@remit/ui";
import { EventDetail } from "@remit/ui";
import { AlertCircle, CalendarDays } from "lucide-react";
import { formatEventWhen } from "@/lib/calendar-format";

/**
 * Why the pane has no event to show: the view does not hold it, it is still
 * being looked for elsewhere, its series leaves it no day to fall on, or the
 * look-up failed.
 */
export type CalendarEventAbsence =
	| "NotInView"
	| "Finding"
	| "NoOccurrences"
	| "Failed";

const ABSENCE: Record<CalendarEventAbsence, { title: string; detail: string }> =
	{
		NotInView: {
			title: "That event isn't on this week",
			detail: "The address names an event the calendar doesn't have here.",
		},
		Finding: {
			title: "Finding the event",
			detail: "Looking for the day it falls on.",
		},
		NoOccurrences: {
			title: "This event has no occurrences",
			detail:
				"Its repeat rule, or the days taken out of it, leave no day for it to fall on.",
		},
		Failed: {
			title: "The event couldn't be looked up",
			detail:
				"Reading the calendar failed. Go back to the calendar and open it again.",
		},
	};

/**
 * The event the address has open.
 *
 * Presentational, like the workspace beside it: the route resolves the event
 * and turns closing, editing and deleting into things it does, so this renders
 * what it is handed and nothing else. Each control appears only when the route
 * gave it somewhere to go — a control that leads nowhere is worse than none.
 */
export interface CalendarEventPaneProps {
	/** Absent when the address names an event the calendar does not have. */
	event: CalendarEventData | undefined;
	calendar: CalendarDescriptor | undefined;
	/** Whether the address names one occurrence rather than the series. */
	isOccurrence: boolean;
	/** What to say when there is no event. Defaults to `NotInView`. */
	absence?: CalendarEventAbsence;
	/**
	 * A write that did not happen, stated where the reader is looking. Empty
	 * when the last one did.
	 */
	problem?: string;
	onEdit?: () => void;
	onDelete?: () => void;
	onClose: () => void;
}

export function CalendarEventPane({
	event,
	calendar,
	isOccurrence,
	absence = "NotInView",
	problem = "",
	onEdit,
	onDelete,
	onClose,
}: CalendarEventPaneProps) {
	if (!event || !calendar) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 bg-surface p-8 text-center">
				<CalendarDays className="size-8 text-fg-subtle" aria-hidden="true" />
				<p className="text-sm font-medium text-fg">{ABSENCE[absence].title}</p>
				<p className="max-w-xs text-sm text-fg-muted">
					{ABSENCE[absence].detail}
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
			{problem !== "" && (
				<div
					role="alert"
					className="flex shrink-0 items-start gap-2 border-b border-danger/40 bg-danger-soft px-row-inset py-2 text-sm"
				>
					<AlertCircle
						className="mt-0.5 size-4 shrink-0 text-danger"
						aria-hidden="true"
					/>
					<p className="min-w-0 flex-1 break-words text-fg">{problem}</p>
				</div>
			)}
			<EventDetail
				event={event}
				calendar={calendar}
				whenText={formatEventWhen(event)}
				onEdit={onEdit}
				onDelete={onDelete}
				onClose={onClose}
				className="min-h-0 flex-1"
			/>
		</div>
	);
}
