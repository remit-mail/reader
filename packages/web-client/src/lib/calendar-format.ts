/**
 * The words a calendar surface puts a time in. Every component in `@remit/ui`
 * takes its text already formatted and owns no clock, so the formatting lives
 * on this side of the seam.
 */
import type { CalendarEventData } from "@remit/ui";

const DAY = new Intl.DateTimeFormat(undefined, {
	weekday: "short",
	day: "numeric",
	month: "long",
});

const CLOCK = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
});

/** "Wed 10 June, 10:00 – 11:00", or the day alone when it runs all of it. */
export function formatEventWhen(event: CalendarEventData): string {
	const start = new Date(event.start);
	const end = new Date(event.end);
	const day = DAY.format(start);
	if (event.allDay) return `${day}, all day`;
	const sameDay = DAY.format(end) === day;
	if (sameDay) return `${day}, ${CLOCK.format(start)} – ${CLOCK.format(end)}`;
	return `${day}, ${CLOCK.format(start)} – ${DAY.format(end)}, ${CLOCK.format(end)}`;
}
