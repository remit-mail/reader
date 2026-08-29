/**
 * `/calendar` has no view of its own: the five zoom levels are five addresses,
 * so a link that names none is sent to the week the reader is in. The week is
 * the default because it is the one that answers "what is my day like" without
 * either scrolling or squinting.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { DEFAULT_CALENDAR_VIEW, isoDate } from "@/lib/calendar-route";

export const Route = createFileRoute("/calendar/")({
	beforeLoad: () => {
		throw redirect({
			to: "/calendar/$view/$date",
			params: { view: DEFAULT_CALENDAR_VIEW, date: isoDate(new Date()) },
			search: { calendarId: undefined },
			replace: true,
		});
	},
});
