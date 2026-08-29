// biome-ignore lint/style/useFilenamingConvention: TanStack Router convention
/**
 * The event itself — the series, where it repeats. An occurrence of it is the
 * `$recurrenceId` segment beside this one.
 */
import { createFileRoute } from "@tanstack/react-router";
import { OpenCalendarEvent } from "@/components/calendar/OpenCalendarEvent";

function CalendarEventRoute() {
	const { calendarObjectId } = Route.useParams();
	return <OpenCalendarEvent calendarObjectId={calendarObjectId} />;
}

export const Route = createFileRoute(
	"/calendar/$view/$date/$calendarObjectId/",
)({
	component: CalendarEventRoute,
});
