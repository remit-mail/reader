import { CalendarPlus } from "lucide-react";
import { useCalendarNavigation } from "@/routing";

/**
 * Writing a new event.
 *
 * A sibling of the open event rather than a child, so navigating here unmatches
 * whatever the calendar had open in the same transition and a composer over an
 * open event cannot be addressed — the move `compose` makes over a thread.
 *
 * The editor itself needs somewhere to save to, so it arrives with the calendar
 * API. The route says that rather than rendering an empty pane.
 */
export function CalendarComposePane() {
	const { closeEvent } = useCalendarNavigation();
	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 bg-surface p-8 text-center">
			<CalendarPlus className="size-8 text-fg-subtle" aria-hidden="true" />
			<p className="text-sm font-medium text-fg">Not built yet</p>
			<p className="max-w-xs text-sm text-fg-muted">
				Writing an event arrives with the calendar API.
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
