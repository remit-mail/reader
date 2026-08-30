/**
 * `/calendar` has no view of its own: the five zoom levels are five addresses,
 * so a link that names none is sent to the week the reader is in. The week is
 * the default because it is the one that answers "what is my day like" without
 * either scrolling or squinting.
 *
 * Whatever the link ticked off travels with it. The query modifies the view
 * rather than choosing it, so it survives being told which view to open.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	calendarSearchSchema,
	DEFAULT_CALENDAR_VIEW,
	isoDate,
} from "@/lib/calendar-route";

export const Route = createFileRoute("/calendar/")({
	validateSearch: calendarSearchSchema,
	beforeLoad: ({ search }) => {
		throw redirect({
			to: "/calendar/$view/$date",
			params: { view: DEFAULT_CALENDAR_VIEW, date: isoDate(new Date()) },
			search,
			replace: true,
		});
	},
});
