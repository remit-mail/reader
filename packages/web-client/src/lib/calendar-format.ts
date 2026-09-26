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

const LONG_DAY = new Intl.DateTimeFormat(undefined, {
	weekday: "long",
	day: "numeric",
	month: "long",
	timeZone: "UTC",
});

const CIVIL_DAY = new Intl.DateTimeFormat(undefined, {
	weekday: "short",
	day: "numeric",
	month: "long",
	timeZone: "UTC",
});

/**
 * "Wed 10 March", for a civil date `YYYY-MM-DD`. A date with no hours is the
 * same day wherever the reader is, so it is never read as an instant.
 */
export function formatCivilDay(date: string): string {
	return CIVIL_DAY.format(new Date(`${date}T00:00:00Z`));
}

/** A span as the kit is handed it: when it starts, when it ends, whether it has hours. */
export type CalendarSpan = Pick<CalendarEventData, "start" | "end" | "allDay">;

/** "Wed 10 June, 10:00 – 11:00", or the day alone when it runs all of it. */
export function formatEventWhen(event: CalendarSpan): string {
	const start = new Date(event.start);
	const end = new Date(event.end);
	const day = DAY.format(start);
	if (event.allDay) return `${day}, all day`;
	const sameDay = DAY.format(end) === day;
	if (sameDay) return `${day}, ${CLOCK.format(start)} – ${CLOCK.format(end)}`;
	return `${day}, ${CLOCK.format(start)} – ${DAY.format(end)}, ${CLOCK.format(end)}`;
}

/** "Thursday 11 June", for a civil date `YYYY-MM-DD` read on no clock at all. */
export function formatDayLabel(date: string): string {
	return LONG_DAY.format(new Date(`${date}T00:00:00Z`));
}

/** "10:00", for a clock time `HH:MM` already on the right clock. */
export function formatClock(time: string): string {
	return CLOCK.format(new Date(`1970-01-01T${time}:00`));
}

/** "10:00", for an instant, on this device's clock. */
export function formatInstantClock(iso: string): string {
	return CLOCK.format(new Date(iso));
}
