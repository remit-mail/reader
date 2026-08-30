/**
 * The days the strip currently holds, and the arithmetic that grows them.
 *
 * The agenda never paginates. It holds one contiguous run of days around the
 * day the address names and grows it at whichever end the reader reaches, so
 * there are no page boundaries to lose a place at and no request that throws
 * away what is already on screen. The range is the only thing a window is: what
 * to ask `/calendar-events` and `/calendar-free-busy` for falls out of it.
 *
 * Nothing here reads a clock or a router. Every function takes the day it works
 * from, which is what lets the rules be asserted without either.
 */
import {
	type BusySpan,
	type CalendarDay,
	datesBetween,
	type FreeStretch,
	freeStretchesFromSpans,
} from "@remit/ui";
import { isoDate } from "@/lib/calendar-route";
import { addDays, type CalendarWindow, calendarWindow } from "./window";

/**
 * Days held behind and ahead of the day the address opened on. More ahead than
 * behind: a reader lands on a calendar to look forward, and the days behind are
 * there so scrolling back a little does not immediately fetch.
 */
export const LEAD_IN = 10;
export const LEAD_OUT = 24;

/** What reaching an end adds to it: the next week, and no more. */
export const PAGE = 7;

/**
 * How far the run grows on the reader's scroll before it stops and asks.
 *
 * A year either way is further than anyone scrolls in one sitting, so the cap
 * costs a reader nothing and bounds the damage of anything that asks for more
 * days without one behind it. The strip is shorter than the reach it fetches at
 * whenever the diary is sparse, and a run that grew on that alone walked out to
 * a decade of empty weeks and took the address with it.
 */
export const CAP_WEEKS = 52;
const CAP_DAYS = CAP_WEEKS * 7;

export interface AgendaRange {
	/** `YYYY-MM-DD`, inclusive. */
	from: string;
	/** `YYYY-MM-DD`, inclusive. */
	to: string;
	/** The earliest day scrolling alone may reach. */
	floor: string;
	/** The latest. */
	ceiling: string;
}

export const rangeAround = (date: string): AgendaRange => ({
	from: addDays(date, -LEAD_IN),
	to: addDays(date, LEAD_OUT),
	floor: addDays(date, -CAP_DAYS),
	ceiling: addDays(date, CAP_DAYS),
});

/** The run has grown as far back as it may on its own. */
export const rangeAtFloor = (range: AgendaRange): boolean =>
	range.from <= range.floor;

export const rangeAtCeiling = (range: AgendaRange): boolean =>
	range.to >= range.ceiling;

const later = (a: string, b: string): string => (a > b ? a : b);
const earlier = (a: string, b: string): string => (a < b ? a : b);

/** At the cap this is the range it was given, identically, so nothing refetches. */
export const extendRangeStart = (range: AgendaRange): AgendaRange =>
	rangeAtFloor(range)
		? range
		: { ...range, from: later(addDays(range.from, -PAGE), range.floor) };

export const extendRangeEnd = (range: AgendaRange): AgendaRange =>
	rangeAtCeiling(range)
		? range
		: { ...range, to: earlier(addDays(range.to, PAGE), range.ceiling) };

/**
 * The cap lifted, by a reader who said so. Another year opens behind the day
 * the run has reached and the days already held stay where they are, so the
 * strip keeps growing on the scroll from there.
 */
export const liftRangeFloor = (range: AgendaRange): AgendaRange =>
	extendRangeStart({ ...range, floor: addDays(range.from, -CAP_DAYS) });

export const liftRangeCeiling = (range: AgendaRange): AgendaRange =>
	extendRangeEnd({ ...range, ceiling: addDays(range.to, CAP_DAYS) });

/**
 * The range that has a day in it. A day already held keeps the range it is in —
 * identically, so a scroll that moved the address does not throw away the days
 * either side of it and refetch them. A day outside it is a jump, and a jump
 * opens a window around where it landed rather than stretching one across the
 * months in between.
 */
export function rangeCovering(range: AgendaRange, date: string): AgendaRange {
	if (date >= range.from && date <= range.to) return range;
	return rangeAround(date);
}

/**
 * The week each day of the range is served by, deduplicated and in order.
 *
 * The strip holds more days than one read may ask for — the server refuses a
 * window over a year — so the range says which weeks to fetch rather than being
 * a window itself. Reaching an end then adds a week to this list instead of
 * widening a single request, which is what keeps the days already on screen
 * where they are.
 *
 * The weeks are `calendarWindow("week", …)` exactly, so they are the grid's own
 * cache entries: a reader who drops into the week grid and comes back out draws
 * from what the strip fetched, and a week the grid has already read costs the
 * strip nothing.
 */
export function weekWindowsOver(dates: readonly string[]): CalendarWindow[] {
	const byStart = new Map<string, CalendarWindow>();
	for (const date of dates) {
		const week = calendarWindow("week", date);
		if (!byStart.has(week.from)) byStart.set(week.from, week);
	}
	return [...byStart.values()];
}

/** The week window a day belongs to, named by its `from`. */
export const weekKeyOf = (date: string): string =>
	calendarWindow("week", date).from;

const MINUTES_IN_DAY = 24 * 60;

const minuteOfInstant = (instant: Date): number =>
	instant.getHours() * 60 + instant.getMinutes();

/**
 * Busy spans as minutes of the days they cross, on the clock this device is
 * reading. The API answers in UTC instants because a busy stretch is an
 * interval rather than a civil date, so the split into days happens here, where
 * the zone the strip is drawn in is known.
 *
 * A span crossing midnight becomes one entry per day it touches. Each day's
 * entries come back sorted and merged, which is the shape the free-time rule
 * takes.
 */
export function busySpansByDate(
	dates: readonly string[],
	spans: readonly { start: string; end: string }[],
): Map<string, BusySpan[]> {
	const held = new Set(dates);
	const byDate = new Map<string, BusySpan[]>();

	for (const span of spans) {
		const start = new Date(span.start);
		const end = new Date(span.end);
		if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
		if (end.getTime() <= start.getTime()) continue;

		const firstDate = isoDate(start);
		// The instant before the end, so a span ending at midnight belongs to the
		// day it ran through rather than opening an empty entry on the next one.
		const lastDate = isoDate(new Date(end.getTime() - 1));
		for (let date = firstDate; date <= lastDate; date = addDays(date, 1)) {
			if (!held.has(date)) continue;
			const from = date === firstDate ? minuteOfInstant(start) : 0;
			// Read off the end's own day rather than off the loop: a span ending at
			// midnight belongs to the day it ran through, where its end is the end
			// of that day and not minute zero of the next one.
			const to = isoDate(end) === date ? minuteOfInstant(end) : MINUTES_IN_DAY;
			if (to <= from) continue;
			const day = byDate.get(date);
			if (day) day.push({ from, to });
			else byDate.set(date, [{ from, to }]);
		}
	}

	for (const [date, day] of byDate) byDate.set(date, mergeSpans(day));
	return byDate;
}

function mergeSpans(spans: BusySpan[]): BusySpan[] {
	const sorted = [...spans].sort((a, b) => a.from - b.from);
	const merged: BusySpan[] = [];
	for (const span of sorted) {
		const last = merged[merged.length - 1];
		if (last && span.from <= last.to) {
			last.to = Math.max(last.to, span.to);
			continue;
		}
		merged.push({ ...span });
	}
	return merged;
}

/**
 * The free time on every day the strip holds, out of the busy spans the server
 * merged across every calendar. It is `freeStretchesFromSpans` and nothing
 * else: the rule lives in `@remit/ui` beside the strip that draws it, so this
 * only decides which spans a day gets.
 */
export function freeStretchesByDate(
	dates: readonly string[],
	spans: readonly { start: string; end: string }[],
): Map<string, FreeStretch[]> {
	const busy = busySpansByDate(dates, spans);
	return new Map(
		dates.map((date) => [
			date,
			freeStretchesFromSpans(date, busy.get(date) ?? []),
		]),
	);
}

/** The days a range names, in order. */
export const datesInRange = (range: AgendaRange): string[] =>
	datesBetween(range.from, range.to);

/** How the strip asks a day what is still open on it. */
export type FreeLookup = (day: CalendarDay) => FreeStretch[];
