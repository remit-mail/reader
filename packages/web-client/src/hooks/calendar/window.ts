/**
 * The stretch of time a calendar surface is asking the server about.
 *
 * A window is derived from the address rather than from the day the reader
 * happens to be on, so every day inside one week asks for the same window and
 * stepping back to a week already read is a cache hit rather than a request.
 *
 * Nothing here reads a clock: the caller passes the day it is drawing, and the
 * offsets come from that day rather than from today, so a window spanning a DST
 * change carries the right offset at each end.
 */
import type { CalendarViewId } from "@remit/ui";

export interface CalendarWindow {
	/** ISO 8601 date-time with offset. Inclusive. */
	from: string;
	/** ISO 8601 date-time with offset. Exclusive. */
	to: string;
}

const pad = (value: number): string => String(value).padStart(2, "0");

const civil = (instant: Date): string =>
	`${instant.getUTCFullYear()}-${pad(instant.getUTCMonth() + 1)}-${pad(
		instant.getUTCDate(),
	)}`;

/** A clock time on a civil date, carrying the offset the device is on then. */
export function isoAt(date: string, time: string): string {
	const local = new Date(`${date}T${time}:00`);
	const offset = -local.getTimezoneOffset();
	const sign = offset < 0 ? "-" : "+";
	const size = Math.abs(offset);
	return `${date}T${time}:00${sign}${pad(Math.floor(size / 60))}:${pad(
		size % 60,
	)}`;
}

/** Midnight on a civil date, carrying the offset the device is on that day. */
export const startOfDay = (date: string): string => isoAt(date, "00:00");

export function addDays(date: string, days: number): string {
	const [year, month, day] = date.split("-").map(Number);
	return civil(new Date(Date.UTC(year, month - 1, day + days)));
}

/** The Monday of the week a day falls in — the day the grid starts weeks on. */
function weekStart(date: string): string {
	const [year, month, day] = date.split("-").map(Number);
	const instant = new Date(Date.UTC(year, month - 1, day));
	return addDays(date, -((instant.getUTCDay() + 6) % 7));
}

function bounds(view: CalendarViewId, date: string): [string, string] {
	const [year, month] = date.split("-").map(Number);
	if (view === "year") return [`${year}-01-01`, `${year + 1}-01-01`];
	if (view === "month") {
		const first = `${year}-${pad(month)}-01`;
		const next =
			month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`;
		return [first, next];
	}
	if (view === "day") return [date, addDays(date, 1)];
	const start = weekStart(date);
	return [start, addDays(start, 7)];
}

/**
 * The window a view over a day covers. Agenda takes the week it loads, which is
 * also the unit it steps by, so the grid and the strip share a cache entry
 * wherever they are looking at the same days.
 */
export function calendarWindow(
	view: CalendarViewId,
	date: string,
): CalendarWindow {
	const [from, to] = bounds(view, date);
	return { from: startOfDay(from), to: startOfDay(to) };
}

/** A window of whole days from one civil date, for a surface rolling its own. */
export function calendarWindowOfDays(
	date: string,
	days: number,
): CalendarWindow {
	return { from: startOfDay(date), to: startOfDay(addDays(date, days)) };
}
