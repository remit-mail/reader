// biome-ignore lint/style/useFilenamingConvention: TanStack Router convention
/**
 * /calendar/{view}/{date}/new — writing an event.
 *
 * A sibling of the event route, so navigating here unmatches whatever the
 * calendar had open in the same transition: nothing has to be closed first, and
 * a composer over an open event is unrepresentable. The address is exactly the
 * move `compose` makes over a mail list.
 */
import { createFileRoute } from "@tanstack/react-router";
import { CalendarComposePane } from "@/components/calendar/CalendarComposePane";

export const Route = createFileRoute("/calendar/$view/$date/new")({
	component: CalendarComposePane,
});
