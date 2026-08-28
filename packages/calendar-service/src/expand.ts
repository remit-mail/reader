import type { CalendarOccurrenceInput } from "@remit/data-ports";
import ICAL from "ical.js";
import type { ParsedCalendar } from "./parse.js";
import { hasRecurrence } from "./project.js";
import { resolveTime, toUtcIso, tzidOf } from "./time.js";

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

const HORIZON_MS = CALENDAR_EXPANSION_HORIZON_DAYS * 24 * 60 * 60 * 1000;

export interface CalendarExpansion {
	occurrences: CalendarOccurrenceInput[];
	/**
	 * The instant through which `occurrences` is complete, or `""` when it holds
	 * the whole series.
	 */
	expandedThrough: string;
}

/**
 * Flattens a resource into the occurrence rows a date-range read returns.
 *
 * A non-recurring resource is one row under an empty `recurrenceId`. A
 * recurring one is a row per occurrence, each keyed by its RECURRENCE-ID slot
 * as a UTC instant — the same canonical form an override's own RECURRENCE-ID
 * resolves to, so an override lands on the occurrence it replaces instead of
 * beside it.
 *
 * EXDATEs are ical.js's business — `ICAL.Event` skips them. Overrides are not
 * left entirely to it: the iterator yields the master's own RRULE and RDATE
 * slots, so an override whose RECURRENCE-ID names a slot the rule never
 * produces — the shape a client writes after moving one instance and then
 * editing the rule — would never be reached. Those are walked explicitly, so
 * every VEVENT in the resource is an occurrence somebody can find.
 */
export const expandCalendar = (
	calendar: ParsedCalendar,
	collectionTimezone: string,
): CalendarExpansion => {
	const resolve = (time: ICAL.Time, tzid: string) =>
		resolveTime(time, tzid, collectionTimezone);

	const startTzidOf = (component: ICAL.Component): string =>
		tzidOf(component.getFirstProperty("dtstart"));

	// DTEND carries its own TZID and need not match DTSTART's, so an end read
	// with the start's zone silently changes the event's length. Only a stated
	// DTEND has a zone of its own: an end ical.js derived from a duration is
	// already in the start's zone, and hinting it with anything else is wrong.
	const endTzidOf = (component: ICAL.Component): string =>
		component.hasProperty("dtend")
			? tzidOf(component.getFirstProperty("dtend"))
			: startTzidOf(component);

	const occurrenceOf = (
		recurrenceId: string,
		startDate: ICAL.Time,
		endDate: ICAL.Time,
		startTzid: string,
		endTzid: string,
	): CalendarOccurrenceInput => {
		const start = resolve(startDate, startTzid);
		const end = resolve(endDate, endTzid);
		return {
			recurrenceId,
			startAt: start.isoUtc,
			endAt: end.isoUtc,
			allDay: start.isDate,
		};
	};

	const event = new ICAL.Event(calendar.master);
	for (const override of calendar.overrides) {
		event.relateException(override);
	}

	if (!hasRecurrence(calendar)) {
		return {
			occurrences: [
				occurrenceOf(
					"",
					event.startDate,
					event.endDate,
					startTzidOf(calendar.master),
					endTzidOf(calendar.master),
				),
			],
			expandedThrough: "",
		};
	}

	// The slot each override claims, canonicalized the same way the iterator's
	// slots are, so the two can be compared at all.
	const overrideBySlot = new Map<string, ICAL.Component>();
	for (const override of calendar.overrides) {
		const recurrenceId = override.getFirstPropertyValue("recurrence-id");
		if (!(recurrenceId instanceof ICAL.Time)) continue;
		overrideBySlot.set(
			resolve(recurrenceId, tzidOf(override.getFirstProperty("recurrence-id")))
				.isoUtc,
			override,
		);
	}

	const seriesStart = resolve(
		event.startDate,
		startTzidOf(calendar.master),
	).instantMs;
	const horizonMs = seriesStart + HORIZON_MS;
	const occurrences: CalendarOccurrenceInput[] = [];
	const claimed = new Set<string>();
	const iterator = event.iterator();
	let truncated = false;

	let next = iterator.next();
	while (next) {
		const slot = resolve(next, startTzidOf(calendar.master));
		if (
			slot.instantMs > horizonMs ||
			occurrences.length >= CALENDAR_EXPANSION_MAX_OCCURRENCES
		) {
			truncated = true;
			break;
		}

		// An overridden slot hands back the override's own DTSTART and DTEND, so
		// the zones to read them in are the override's. A plain slot hands back
		// the rule's start and an end derived from the master's duration, both in
		// the master's start zone.
		const source = overrideBySlot.get(slot.isoUtc);
		const details = event.getOccurrenceDetails(next);
		claimed.add(slot.isoUtc);
		occurrences.push(
			occurrenceOf(
				slot.isoUtc,
				details.startDate,
				details.endDate,
				startTzidOf(source ?? calendar.master),
				source ? endTzidOf(source) : startTzidOf(calendar.master),
			),
		);
		next = iterator.next();
	}

	const iterated = occurrences[occurrences.length - 1];
	const expandedThrough =
		truncated && iterated ? toUtcIso(Date.parse(iterated.startAt)) : "";

	// Overrides the rule never reached. Written regardless of the horizon: they
	// are a bounded, explicit list, and one moved instance is exactly the thing
	// a user goes looking for.
	for (const [slot, override] of overrideBySlot) {
		if (claimed.has(slot)) continue;
		const overrideEvent = new ICAL.Event(override);
		occurrences.push(
			occurrenceOf(
				slot,
				overrideEvent.startDate,
				overrideEvent.endDate,
				startTzidOf(override),
				endTzidOf(override),
			),
		);
	}

	occurrences.sort((left, right) => left.startAt.localeCompare(right.startAt));

	return { occurrences, expandedThrough };
};
