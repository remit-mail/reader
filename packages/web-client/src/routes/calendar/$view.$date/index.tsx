// biome-ignore lint/style/useFilenamingConvention: TanStack Router convention
/**
 * The calendar's reading pane with nothing open. It is a route because the pane
 * belongs to the view it was opened from, and the event and the composer arrive
 * as segments beside it.
 */

import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";

function CalendarReadingPane() {
	return (
		<div className="flex h-full items-center justify-center bg-surface">
			<EmptyState
				message="Pick an event to read it here."
				icon={<CalendarDays className="size-8" />}
			/>
		</div>
	);
}

export const Route = createFileRoute("/calendar/$view/$date/")({
	component: CalendarReadingPane,
});
