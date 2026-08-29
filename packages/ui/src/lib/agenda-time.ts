/**
 * The arithmetic the agenda needs and a grid does not.
 *
 * A time grid renders empty hours and lets the reader find the gaps. A list has
 * to name them, so free time here is computed rather than left as whitespace:
 * the stretches inside a day, the runs of days with nothing on them at all, and
 * the answer to "what is the next thing". Every function is pure and reads its
 * clock from a parameter, so a story and a test give the same answer.
 */
import { Temporal } from "temporal-polyfill";
import type {
	CalendarDay,
	CalendarEventData,
} from "../components/calendar-types.js";

/** The window a free stretch is measured inside. Nobody wants "free 02:00–07:00". */
export const DAY_START_MINUTE = 8 * 60;
export const DAY_END_MINUTE = 22 * 60;

/** Under this a gap is the walk between two rooms, not free time. */
export const FREE_MINUTES = 90;

export function minuteOfDay(iso: string): number {
	return Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
}

export function formatMinute(minute: number): string {
	const clamped = Math.max(0, Math.min(24 * 60, Math.round(minute)));
	return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(
		clamped % 60,
	).padStart(2, "0")}`;
}

/** "4h 45m", "2h", "45m". */
export function formatSpan(minutes: number): string {
	const whole = Math.round(minutes);
	if (whole < 60) return `${whole}m`;
	const hours = Math.floor(whole / 60);
	const rest = whole % 60;
	return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function addDays(date: string, days: number): string {
	const cursor = new Date(`${date}T00:00:00Z`);
	cursor.setUTCDate(cursor.getUTCDate() + days);
	return cursor.toISOString().slice(0, 10);
}

export function datesBetween(from: string, to: string): string[] {
	const dates: string[] = [];
	for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1))
		dates.push(cursor);
	return dates;
}

export function monthLabel(date: string): string {
	const [year, month, day] = date.split("-").map(Number);
	return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
		month: "long",
		year: "numeric",
	});
}

export function shortMonthLabel(date: string): string {
	const [year, month, day] = date.split("-").map(Number);
	return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
		month: "short",
	});
}

/** "Thu 11 Jun". */
export function formatShortDay(date: string): string {
	const [year, month, day] = date.split("-").map(Number);
	return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
		weekday: "short",
		day: "numeric",
		month: "short",
	});
}

export function weekdayLongLabel(date: string): string {
	const [year, month, day] = date.split("-").map(Number);
	return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
		weekday: "long",
	});
}

/** "Sat 20 – Thu 25 June", collapsing the month when both ends share one. */
export function formatRunLabel(from: string, to: string): string {
	const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
	const [toYear, toMonth, toDay] = to.split("-").map(Number);
	const first = new Date(fromYear, fromMonth - 1, fromDay);
	const last = new Date(toYear, toMonth - 1, toDay);
	const opening = first.toLocaleDateString("en-GB", {
		weekday: "short",
		day: "numeric",
		...(fromMonth === toMonth ? {} : { month: "short" }),
	});
	const closing = last.toLocaleDateString("en-GB", {
		weekday: "short",
		day: "numeric",
		month: "short",
	});
	return `${opening} – ${closing}`;
}

export function weekdayShortLabel(date: string): string {
	const [year, month, day] = date.split("-").map(Number);
	return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
		weekday: "short",
	});
}

function instantOf(iso: string): number {
	return new Date(iso).getTime();
}

/** An all-day range ends on the morning after its last day. */
function coversDay(event: CalendarEventData, date: string): boolean {
	if (!event.allDay) return event.start.slice(0, 10) === date;
	return date >= event.start.slice(0, 10) && date < event.end.slice(0, 10);
}

function overlaps(a: CalendarEventData, b: CalendarEventData): boolean {
	return (
		instantOf(a.start) < instantOf(b.end) &&
		instantOf(b.start) < instantOf(a.end)
	);
}

/** Clock time covered by at least one of these, counted once. */
export function busyMinutesOf(timed: readonly CalendarEventData[]): number {
	const spans = timed
		.map((event) => [instantOf(event.start), instantOf(event.end)] as const)
		.sort((a, b) => a[0] - b[0]);
	let covered = 0;
	let openFrom = 0;
	let openTo = 0;
	for (const [from, to] of spans) {
		if (from > openTo) {
			covered += openTo - openFrom;
			openFrom = from;
			openTo = to;
			continue;
		}
		openTo = Math.max(openTo, to);
	}
	covered += openTo - openFrom;
	return Math.round(covered / 60_000);
}

/** Every event that runs into another, grouped around the one it collides with. */
export function conflictsOf(timed: readonly CalendarEventData[]): string[][] {
	const groups: string[][] = [];
	for (const anchor of timed) {
		const group = timed
			.filter((other) => other.id === anchor.id || overlaps(anchor, other))
			.map((event) => event.id)
			.sort();
		if (group.length < 2) continue;
		const key = group.join("|");
		if (!groups.some((existing) => existing.join("|") === key))
			groups.push(group);
	}
	return groups.filter(
		(group) =>
			!groups.some(
				(other) => other !== group && group.every((id) => other.includes(id)),
			),
	);
}

/** One day assembled out of a flat event list — the shape every surface takes. */
export function buildCalendarDay(
	date: string,
	events: readonly CalendarEventData[],
	today: string,
): CalendarDay {
	const onDay = events.filter((event) => coversDay(event, date));
	const timed = onDay
		.filter((event) => !event.allDay)
		.sort((a, b) => instantOf(a.start) - instantOf(b.start));
	return {
		date,
		weekdayLabel: weekdayShortLabel(date),
		dayNumber: Number(date.slice(8)),
		isToday: date === today,
		timed,
		allDay: onDay.filter((event) => event.allDay),
		busyMinutes: busyMinutesOf(timed),
		conflicts: conflictsOf(timed),
	};
}

export function isEmptyDay(day: CalendarDay): boolean {
	return day.timed.length === 0 && day.allDay.length === 0;
}

/** Nothing on the clock, whatever banners the day carries. */
export function isClearDay(day: CalendarDay): boolean {
	return day.timed.length === 0;
}

export interface FreeStretch {
	date: string;
	startMinute: number;
	endMinute: number;
	minutes: number;
	/** The day has no timed events at all, so the stretch is the whole day. */
	wholeDay: boolean;
}

export interface BusySpan {
	from: number;
	to: number;
}

/**
 * The minutes of the day that are actually covered. Four meetings stacked on
 * each other take one hour off a day, not four, and every summary in this
 * option is measured off that rather than off a row count.
 */
export function busySpansOn(day: CalendarDay): BusySpan[] {
	return mergeBusySpans(
		day.timed.map((event) => ({
			from: minuteOfDay(event.start),
			to: minuteOfDay(event.end),
		})),
	);
}

/**
 * Spans in start order, with anything that runs into its neighbour joined to
 * it. Every reading of busy time goes through this, so a caller never has to
 * know whether the spans it holds were already in order — one meeting split
 * across two calendars and one that ran late are the same shape by the time
 * anything measures free time against them.
 */
export function mergeBusySpans(spans: readonly BusySpan[]): BusySpan[] {
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

function insideWindow(minute: number): number {
	return Math.min(Math.max(minute, DAY_START_MINUTE), DAY_END_MINUTE);
}

/**
 * The gaps between merged busy spans, inside the window worth calling a day.
 *
 * Both ends of every span are pulled into the window before they are measured,
 * and the cursor only ever moves forward, so an event running past the window
 * cannot stretch a band past it either and a span that ends before it starts —
 * an overnight event, which the editor writes onto one date — cannot leave the
 * cursor where the tail would emit a second band over the first.
 *
 * Spans rather than a day, because busy time is not always drawn: a calendar
 * the reader has unticked, and every calendar the server merges into
 * `/calendar-free-busy`, still take hours out of a Thursday. One rule answers
 * "when am I free" wherever the busy time was measured, so the strip and the
 * server cannot disagree about the same afternoon.
 *
 * The spans are put in order and joined here rather than being required that
 * way. The cursor only moves forward, so spans handed over out of order would
 * silently emit a band across time that is booked — a caller cannot be asked to
 * remember a precondition whose only symptom is being told an afternoon is free
 * when it is not.
 */
export function freeStretchesFromSpans(
	date: string,
	spans: readonly BusySpan[],
	minMinutes = FREE_MINUTES,
): FreeStretch[] {
	const busy = mergeBusySpans(spans);
	if (busy.length === 0)
		return [
			{
				date,
				startMinute: DAY_START_MINUTE,
				endMinute: DAY_END_MINUTE,
				minutes: DAY_END_MINUTE - DAY_START_MINUTE,
				wholeDay: true,
			},
		];

	const stretches: FreeStretch[] = [];
	let cursor = DAY_START_MINUTE;
	for (const span of busy) {
		const from = insideWindow(span.from);
		const to = insideWindow(span.to);
		if (from - cursor >= minMinutes)
			stretches.push({
				date,
				startMinute: cursor,
				endMinute: from,
				minutes: from - cursor,
				wholeDay: false,
			});
		cursor = Math.max(cursor, from, to);
	}
	if (DAY_END_MINUTE - cursor >= minMinutes)
		stretches.push({
			date,
			startMinute: cursor,
			endMinute: DAY_END_MINUTE,
			minutes: DAY_END_MINUTE - cursor,
			wholeDay: false,
		});
	return stretches;
}

/** The free time left by the events on a day, which is the same rule. */
export function freeStretchesOn(
	day: CalendarDay,
	minMinutes = FREE_MINUTES,
): FreeStretch[] {
	return freeStretchesFromSpans(day.date, busySpansOn(day), minMinutes);
}

export interface ClashOptions {
	/** Spans that are not a clash: the candidate itself, or one already answered. */
	ignoreIds?: readonly string[];
}

export interface WallSpan {
	start: string;
	end: string;
}

/**
 * The hours a mail printed, read as times on `sourceZone` and written again on
 * `displayZone` — the clock this calendar stores and draws.
 *
 * A zoneless reading carries an offset it has no right to: 16:00 sits in the
 * fixture on +02:00 because something had to be written there. Once the reader
 * says which clock the mail meant, the wall times are what survive and the
 * instants are recomputed from them, so picking Lisbon moves the event an hour
 * rather than relabelling it. Both zones are arguments; neither is read from
 * the environment.
 *
 * Only the start is converted; the end is the start plus the span the mail
 * printed. Converting both ends independently silently rewrites the length of
 * anything that straddles a transition — an hour of a two-hour meeting is lost
 * across a spring-forward and an hour is invented across a fall-back.
 *
 * A wall time the source zone skips moves forward to the hour that replaced it,
 * and one it repeats takes the first of the two, which is what `compatible`
 * disambiguation means. An all-day value has no clock to read and passes
 * through untouched.
 */
export function wallSpanOn(
	span: WallSpan,
	sourceZone: string,
	displayZone: string,
): WallSpan {
	if (!span.start.includes("T") || !span.end.includes("T"))
		return { start: span.start, end: span.end };
	const printedStart = Temporal.PlainDateTime.from(span.start.slice(0, 19));
	const printedEnd = Temporal.PlainDateTime.from(span.end.slice(0, 19));
	const start = printedStart
		.toZonedDateTime(sourceZone)
		.withTimeZone(displayZone);
	const end = start.add(
		printedStart.until(printedEnd, {
			largestUnit: "minute",
		}),
	);
	return {
		start: start.toString({ timeZoneName: "never" }),
		end: end.toString({ timeZoneName: "never" }),
	};
}

/**
 * Whatever a candidate span runs into, so the clash is named before the answer.
 *
 * A declined event is not a commitment and an all-day banner is not an hour, so
 * neither clashes. Spans are compared as instants, which is why every ISO the
 * fixtures write carries its offset: two events written in different zones are
 * still measured against the same line.
 */
export function clashesWith(
	candidate: { start: string; end: string },
	source: readonly CalendarEventData[],
	{ ignoreIds = [] }: ClashOptions = {},
): CalendarEventData[] {
	const from = Date.parse(candidate.start);
	const to = Date.parse(candidate.end);
	return source.filter((item) => {
		if (item.allDay || item.myRsvp === "declined") return false;
		if (ignoreIds.includes(item.id)) return false;
		return Date.parse(item.start) < to && from < Date.parse(item.end);
	});
}

/**
 * One entry in the strip. A day with something on it stands alone; a run of
 * days with nothing at all becomes a single line, because six empty screens is
 * a worse answer to "am I free" than one sentence saying so.
 */
export type AgendaRow =
	| { kind: "day"; key: string; day: CalendarDay }
	| { kind: "run"; key: string; from: string; to: string; days: number };

export function buildAgendaRows(
	days: CalendarDay[],
	keep: readonly string[],
): AgendaRow[] {
	const rows: AgendaRow[] = [];
	let run: CalendarDay[] = [];

	const flush = () => {
		if (run.length === 0) return;
		if (run.length === 1)
			rows.push({ kind: "day", key: run[0].date, day: run[0] });
		else
			rows.push({
				kind: "run",
				key: `run_${run[0].date}`,
				from: run[0].date,
				to: run[run.length - 1].date,
				days: run.length,
			});
		run = [];
	};

	for (const day of days) {
		if (isEmptyDay(day) && !keep.includes(day.date)) {
			run.push(day);
			continue;
		}
		flush();
		rows.push({ kind: "day", key: day.date, day });
	}
	flush();
	return rows;
}

/** Events that run into each other, grouped; everything else on its own. */
export function groupOverlapping(
	timed: CalendarEventData[],
): CalendarEventData[][] {
	const groups: CalendarEventData[][] = [];
	for (const event of timed) {
		const group = groups[groups.length - 1];
		const reach = group
			? Math.max(...group.map((member) => Date.parse(member.end)))
			: 0;
		if (group && Date.parse(event.start) < reach) {
			group.push(event);
			continue;
		}
		groups.push([event]);
	}
	return groups;
}

export interface NextUp {
	/** Happening at `nowIso`. */
	running: CalendarEventData[];
	next: CalendarEventData | undefined;
	minutesUntilNext: number;
	after: CalendarEventData | undefined;
	/** Still to come today, counting what is running. */
	restOfDay: number;
	/** The first stretch worth calling free, clipped to start no earlier than now. */
	free: FreeStretch | undefined;
}

export function readNextUp(days: CalendarDay[], nowIso: string): NextUp {
	const now = Date.parse(nowIso);
	const today = nowIso.slice(0, 10);
	const timed = days
		.flatMap((day) => day.timed)
		.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

	const running = timed.filter(
		(event) => Date.parse(event.start) <= now && Date.parse(event.end) > now,
	);
	const ahead = timed.filter((event) => Date.parse(event.start) > now);
	const next = ahead[0];
	const restOfDay =
		running.filter((event) => event.start.slice(0, 10) === today).length +
		ahead.filter((event) => event.start.slice(0, 10) === today).length;

	return {
		running,
		next,
		minutesUntilNext: next
			? Math.round((Date.parse(next.start) - now) / 60_000)
			: 0,
		after: ahead[1],
		restOfDay,
		free: freeAhead(days, nowIso, 1)[0],
	};
}

/** The next free stretches across the strip, in order, starting from now. */
export function freeAhead(
	days: CalendarDay[],
	nowIso: string,
	limit: number,
): FreeStretch[] {
	const today = nowIso.slice(0, 10);
	const nowMinute = minuteOfDay(nowIso);
	const found: FreeStretch[] = [];

	for (const day of days) {
		if (day.date < today) continue;
		for (const stretch of freeStretchesOn(day)) {
			if (day.date > today) {
				found.push(stretch);
			} else {
				const from = Math.max(stretch.startMinute, nowMinute);
				if (stretch.endMinute - from < FREE_MINUTES) continue;
				found.push({
					...stretch,
					startMinute: from,
					minutes: stretch.endMinute - from,
					wholeDay: stretch.wholeDay && from === stretch.startMinute,
				});
			}
			if (found.length === limit) return found;
		}
	}
	return found;
}
