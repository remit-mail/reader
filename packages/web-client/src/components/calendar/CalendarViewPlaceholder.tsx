import { CalendarRange } from "lucide-react";

export function CalendarViewPlaceholder() {
	return (
		<div
			className="flex h-full flex-col items-center justify-center gap-2 bg-surface p-8 text-center"
			data-testid="calendar-placeholder-year"
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
