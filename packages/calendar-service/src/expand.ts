import type { CalendarOccurrenceInput } from "@remit/data-ports";
import ICAL from "ical.js";
import type { ParsedCalendar } from "./parse.js";
import { hasRecurrence } from "./project.js";
import {
	dtEndTzid,
	dtStartTzid,
	resolveTime,
	toUtcIso,
	tzidOf,
} from "./time.js";

/**
 * How far past a series' own start its occurrences are written out.
 *
 * A recurring event may have no end at all, so something has to bound the
 * write. Two years covers every view a client asks for today and keeps the
 * index one bounded write rather than an unbounded one; a resource whose series
 * runs past it is marked with `expandedThrough` and stays the business of the
 * live expansion that reads it.
 */
export const CALENDAR_EXPANSION_HORIZON_DAYS = 730;

/**
 * Ceiling on occurrences written for one resource, independent of the horizon.
 * A per-minute RRULE fits three quarters of a million instances inside two
 * years; the ceiling turns that into a marked, truncated index instead of a
 * write that takes the process down.
 */
export const CALENDAR_EXPANSION_MAX_OCCURRENCES = 1000;

/**
 * Ceiling on iterator steps a live window expansion may take.
 *
 * A window expansion walks the series from its own start, because a rule is
 * only meaningful from where it was anchored. A daily event written in 2005 is
 * a few thousand steps away from today, which is cheap; a per-minute one is
 * millions, which is a read that never returns. The cap turns the second case
 * into a short answer rather than a hung request.
 */
export const CALENDAR_WINDOW_MAX_STEPS = 50_000;

const HORIZON_MS = CALENDAR_EXPANSION_HORIZON_DAYS * 24 * 60 * 60 * 1000;

export interface CalendarExpansion {
	occurrences: CalendarOccurrenceInput[];
	/**
	 * The instant through which `occurrences` is complete, or `""` when it holds
	 * the whole series.
	 */
	expandedThrough: string;
}

const occurrenceOf = (
	collectionTimezone: string,
	recurrenceId: string,
	startDate: ICAL.Time,
	endDate: ICAL.Time,
	startTzid: string,
	endTzid: string,
): CalendarOccurrenceInput => {
	const start = resolveTime(startDate, startTzid, collectionTimezone);
	const end = resolveTime(endDate, endTzid, collectionTimezone);
	return {
		recurrenceId,
		startAt: start.isoUtc,
		endAt: end.isoUtc,
		allDay: start.isDate,
	};
};

/**
 * The slot each override claims, canonicalized the way the iterator's slots
 * are, so the two can be compared at all.
 */
export const overridesBySlot = (
	calendar: ParsedCalendar,
	collectionTimezone: string,
): Map<string, ICAL.Component> => {
	const bySlot = new Map<string, ICAL.Component>();
	for (const override of calendar.overrides) {
		const recurrenceId = override.getFirstPropertyValue("recurrence-id");
		if (!(recurrenceId instanceof ICAL.Time)) continue;
		const slot = resolveTime(
			recurrenceId,
			tzidOf(override.getFirstProperty("recurrence-id")),
			collectionTimezone,
		).isoUtc;
		bySlot.set(slot, override);
	}
	return bySlot;
};

/** The window a walk collects occurrences in, and what bounds the walk. */
interface WalkBounds {
	/** Occurrences starting before this are stepped past, not collected. */
	fromMs: number;
	/** The walk stops once a slot starts after this. */
	throughMs: number;
	maxOccurrences: number;
	maxSteps: number;
}

interface Walk {
	occurrences: CalendarOccurrenceInput[];
	/** Whether the walk stopped on a bound rather than on the series ending. */
	truncated: boolean;
	/** Start of the last slot the iterator itself produced, or `""` for none. */
	lastIteratedStart: string;
}

/**
 * Walks a recurring resource's occurrences between the bounds it is given.
 *
 * EXDATEs are ical.js's business — `ICAL.Event` skips them. Overrides are not
 * left entirely to it: the iterator yields the master's own RRULE and RDATE
 * slots, so an override whose RECURRENCE-ID names a slot the rule never
 * produces — the shape a client writes after moving one instance and then
 * editing the rule — would never be reached. Those are walked explicitly, so
 * every VEVENT in the resource is an occurrence somebody can find.
 */
const walkOccurrences = (
	calendar: ParsedCalendar,
	collectionTimezone: string,
	bounds: WalkBounds,
): Walk => {
	const event = new ICAL.Event(calendar.master);
	for (const override of calendar.overrides) {
		event.relateException(override);
	}

	const overrideBySlot = overridesBySlot(calendar, collectionTimezone);
	const masterStartTzid = dtStartTzid(calendar.master);
	const occurrences: CalendarOccurrenceInput[] = [];
	const claimed = new Set<string>();
	const iterator = event.iterator();
	let truncated = false;
	let steps = 0;
	let lastIteratedStart = "";

	let next = iterator.next();
	while (next) {
		const slot = resolveTime(next, masterStartTzid, collectionTimezone);
		if (
			slot.instantMs > bounds.throughMs ||
			occurrences.length >= bounds.maxOccurrences ||
			steps >= bounds.maxSteps
		) {
			truncated = true;
			break;
		}
		steps += 1;
		claimed.add(slot.isoUtc);

		if (slot.instantMs >= bounds.fromMs) {
			// An overridden slot hands back the override's own DTSTART and DTEND, so
			// the zones to read them in are the override's. A plain slot hands back
			// the rule's start and an end derived from the master's duration, both in
			// the master's start zone.
			const source = overrideBySlot.get(slot.isoUtc);
			const details = event.getOccurrenceDetails(next);
			occurrences.push(
				occurrenceOf(
					collectionTimezone,
					slot.isoUtc,
					details.startDate,
					details.endDate,
					dtStartTzid(source ?? calendar.master),
					source ? dtEndTzid(source) : masterStartTzid,
				),
			);
			lastIteratedStart = occurrences[occurrences.length - 1]?.startAt ?? "";
		}
		next = iterator.next();
	}

	// Overrides the rule never reached. Kept regardless of the horizon: they are
	// a bounded, explicit list, and one moved instance is exactly the thing a
	// user goes looking for.
	for (const [slot, override] of overrideBySlot) {
		if (claimed.has(slot)) continue;
		const overrideEvent = new ICAL.Event(override);
		const occurrence = occurrenceOf(
			collectionTimezone,
			slot,
			overrideEvent.startDate,
			overrideEvent.endDate,
			dtStartTzid(override),
			dtEndTzid(override),
		);
		const startMs = Date.parse(occurrence.startAt);
		if (startMs < bounds.fromMs || startMs > bounds.throughMs) continue;
		occurrences.push(occurrence);
	}

	occurrences.sort((left, right) => left.startAt.localeCompare(right.startAt));

	return { occurrences, truncated, lastIteratedStart };
};

/** The one occurrence a resource that does not recur produces. */
const singleOccurrence = (
	calendar: ParsedCalendar,
	collectionTimezone: string,
): CalendarOccurrenceInput => {
	const event = new ICAL.Event(calendar.master);
	return occurrenceOf(
		collectionTimezone,
		"",
		event.startDate,
		event.endDate,
		dtStartTzid(calendar.master),
		dtEndTzid(calendar.master),
	);
};

/**
 * Flattens a resource into the occurrence rows a date-range read returns.
 *
 * A non-recurring resource is one row under an empty `recurrenceId`. A
 * recurring one is a row per occurrence, each keyed by its RECURRENCE-ID slot
 * as a UTC instant — the same canonical form an override's own RECURRENCE-ID
 * resolves to, so an override lands on the occurrence it replaces instead of
 * beside it.
 *
 * The horizon is anchored at the series' own start, not at today: two years of
 * a series is a bounded write whatever a caller's clock says. A series running
 * past it comes back marked with `expandedThrough`, which is what tells a later
 * read to expand that resource live instead of trusting the index.
 */
export const expandCalendar = (
	calendar: ParsedCalendar,
	collectionTimezone: string,
): CalendarExpansion => {
	if (!hasRecurrence(calendar)) {
		return {
			occurrences: [singleOccurrence(calendar, collectionTimezone)],
			expandedThrough: "",
		};
	}

	const event = new ICAL.Event(calendar.master);
	const seriesStart = resolveTime(
		event.startDate,
		dtStartTzid(calendar.master),
		collectionTimezone,
	).instantMs;

	const walk = walkOccurrences(calendar, collectionTimezone, {
		fromMs: Number.NEGATIVE_INFINITY,
		throughMs: seriesStart + HORIZON_MS,
		maxOccurrences: CALENDAR_EXPANSION_MAX_OCCURRENCES,
		maxSteps: Number.POSITIVE_INFINITY,
	});

	return {
		occurrences: walk.occurrences,
		expandedThrough:
			walk.truncated && walk.lastIteratedStart
				? toUtcIso(Date.parse(walk.lastIteratedStart))
				: "",
	};
};

/**
 * The occurrences of a resource that fall inside one window, computed rather
 * than read.
 *
 * This is what serves a view of a series whose stored index stops before the
 * window — an open-ended weekly meeting written years ago, whose horizon ran
 * out long before today. The alternative is extending the index on read, which
 * turns every view of an old series into an unbounded write; a bounded
 * computation that persists nothing is the cheaper half of that trade, and the
 * one that cannot leave anything behind to be wrong later.
 */
export const expandCalendarWindow = (
	calendar: ParsedCalendar,
	collectionTimezone: string,
	window: { fromMs: number; toMs: number },
): CalendarOccurrenceInput[] => {
	if (!hasRecurrence(calendar)) {
		return [singleOccurrence(calendar, collectionTimezone)];
	}

	return walkOccurrences(calendar, collectionTimezone, {
		fromMs: window.fromMs,
		throughMs: window.toMs,
		maxOccurrences: CALENDAR_EXPANSION_MAX_OCCURRENCES,
		maxSteps: CALENDAR_WINDOW_MAX_STEPS,
	}).occurrences;
};
