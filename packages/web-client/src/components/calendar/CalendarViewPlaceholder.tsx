import type { CalendarViewId } from "@remit/ui";
import { CalendarRange } from "lucide-react";

/**
 * A zoom level that is named but not drawn yet, so the route stays addressable
 * and says so rather than rendering nothing that reads as an empty week.
 */
export interface CalendarViewPlaceholderProps {
	view: CalendarViewId;
}

export function CalendarViewPlaceholder({
	view,
}: CalendarViewPlaceholderProps) {
	return (
		<div
			className="flex h-full flex-col items-center justify-center gap-2 bg-surface p-8 text-center"
			data-testid={`calendar-placeholder-${view}`}
		>
			<CalendarRange className="size-8 text-fg-subtle" aria-hidden="true" />
			<p className="text-sm font-medium text-fg">Not built yet</p>
			<p className="max-w-xs text-sm text-fg-muted">
				The year grid arrives with the rest of the zoom ladder. Month, Week, Day
				and Agenda work now.
			</p>
		</div>
	);
}
