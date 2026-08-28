import type { CalendarSlotPick } from "../components/calendar-types.js";
import { addMinutesToClock } from "./event-phrase.js";

/** How long a new event is when nobody said — the hour every other path starts from. */
export const DRAFT_MINUTES = 60;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/**
 * A pick is read off the ISO strings the calendar hands the callback, never off
 * its `Date`. The grid runs in the calendar's own zone; a `Date` read through
 * `getHours()` is that instant in the host's zone, so a UTC runner would draft
 * 09:00 for a click on 11:00.
 */
export function rangePick(
	startStr: string,
	endStr: string,
	allDay: boolean,
): CalendarSlotPick {
	if (allDay) return allDayPick(startStr);
	return {
		date: startStr.slice(0, 10),
		startTime: startStr.slice(11, 16),
		endTime: endStr.slice(11, 16),
		allDay: false,
	};
}

/** A single point on the grid, an hour long because nothing said otherwise. */
export function pointPick(dateStr: string, allDay: boolean): CalendarSlotPick {
	if (allDay) return allDayPick(dateStr);
	const startTime = dateStr.slice(11, 16);
	return {
		date: dateStr.slice(0, 10),
		startTime,
		endTime: addMinutesToClock(startTime, DRAFT_MINUTES),
		allDay: false,
	};
}

function allDayPick(dateStr: string): CalendarSlotPick {
	return {
		date: dateStr.slice(0, 10),
		startTime: "",
		endTime: "",
		allDay: true,
	};
}

/**
 * Whether a selection was dragged across the grid rather than landing on it.
 * One slot, or one day, is as small as a selection gets, which is exactly what
 * a click leaves behind — and a click is already a pick of its own.
 */
export function isDraggedSelection(
	startStr: string,
	endStr: string,
	allDay: boolean,
	slotMinutes: number,
): boolean {
	const span = Date.parse(endStr) - Date.parse(startStr);
	if (allDay) return Math.round(span / MS_PER_DAY) > 1;
	return span / MS_PER_MINUTE > slotMinutes;
}
