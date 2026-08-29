import type { CalendarViewId } from "@remit/ui";
import { CalendarRange } from "lucide-react";

/**
 * A zoom level that is named but not drawn yet.
 *
 * The ladder is five steps and three of them arrive later, so the route stays
 * addressable and says what it is waiting on. A view that silently rendered
 * nothing would be indistinguishable from a week with nothing in it.
 */
const WAITING_ON: Record<string, string> = {
	year: "The year grid arrives with the rest of the zoom ladder.",
	month: "The month grid arrives with the rest of the zoom ladder.",
	agenda: "The agenda arrives with the scrolling day strip.",
};

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
				{WAITING_ON[view] ?? "This view arrives in a later stage."} Week and Day
				work now.
			</p>
		</div>
	);
}
