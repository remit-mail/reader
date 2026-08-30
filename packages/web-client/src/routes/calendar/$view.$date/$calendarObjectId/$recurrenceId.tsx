// biome-ignore lint/style/useFilenamingConvention: TanStack Router convention
/**
 * One occurrence of a repeating event, under the series it belongs to.
 *
 * A segment rather than a param on the event, because an edit asks which
 * instances it applies to and the answer starts from the one on screen: the
 * series stays matched behind the occurrence, so the address names both.
 */
import { createFileRoute } from "@tanstack/react-router";
import { OpenCalendarEvent } from "@/components/calendar/OpenCalendarEvent";

function CalendarOccurrenceRoute() {
	const { calendarObjectId, recurrenceId } = Route.useParams();
	return (
		<OpenCalendarEvent
			calendarObjectId={calendarObjectId}
			recurrenceId={recurrenceId}
		/>
	);
}

export const Route = createFileRoute(
	"/calendar/$view/$date/$calendarObjectId/$recurrenceId",
)({
	component: CalendarOccurrenceRoute,
});
