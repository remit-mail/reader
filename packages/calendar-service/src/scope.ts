import { RecurrenceScope } from "@remit/domain-enums";
import ICAL from "ical.js";
import { applyEventFields, type CalendarEventFields } from "./build.js";
import { type CalendarResult, calendarFailure } from "./errors.js";
import { CALENDAR_WINDOW_MAX_STEPS, overridesBySlot } from "./expand.js";
import {
	type ParsedCalendar,
	parseCalendar,
	serializeCalendar,
} from "./parse.js";
import { hasRecurrence } from "./project.js";
import { dtStartTzid, resolveTime, toUtcIso, tzidOf } from "./time.js";

export type RecurrenceScopeValue =
	(typeof RecurrenceScope)[keyof typeof RecurrenceScope];

/**
 * What a scoped write turns into on the store.
 *
 * `Split` is the only one that is not a single resource: iCalendar has no way
 * to say "the rest of this series is different", so a `Following` edit really
 * is two resources — the truncated original and a new one under a UID of its
 * own. Both go through the one write path rather than through a second.
 */
export type ScopedWrite =
	| { kind: "Replace"; icalData: string }
	| { kind: "Split"; icalData: string; following: string }
	| { kind: "Delete" };

export interface ScopedWriteInput {
	scope: RecurrenceScopeValue;
	/** ISO 8601 UTC instant naming the occurrence the write was made from, or `""`. */
	recurrenceId: string;
	/** UID the resource a `Following` split creates is written under. */
	followingUid: string;
}

interface FoundOccurrence {
	/** The rule slot, in whatever form the master's DTSTART is written in. */
	slot: ICAL.Time;
	slotUtc: string;
	/** The occurrence as the series produces it; absent when only an override names the slot. */
	details: ReturnType<ICAL.Event["getOccurrenceDetails"]> | null;
	/** Position in the rule's own sequence, `-1` when the rule never reaches it. */
	index: number;
	override: ICAL.Component | null;
}

/** A deep copy of a resource, taken the one way that cannot share structure. */
const cloneCalendar = (
	calendar: ParsedCalendar,
): Promise<CalendarResult<ParsedCalendar>> =>
	parseCalendar(serializeCalendar(calendar.component));

const timeProperty = (
	name: string,
	time: ICAL.Time,
	tzid: string,
): ICAL.Property => {
	const property = new ICAL.Property(name);
	property.setValue(time);
	if (!time.isDate && tzid !== "") property.setParameter("tzid", tzid);
	return property;
};

const setTimeValue = (
	component: ICAL.Component,
	name: string,
	time: ICAL.Time,
	tzid: string,
): void => {
	const existing = component.getFirstProperty(name);
	if (existing) {
		existing.setValue(time);
		return;
	}
	component.addProperty(timeProperty(name, time, tzid));
};

/**
 * The occurrence a scoped write is anchored at.
 *
 * Walks the series rather than trusting the caller's instant: a RECURRENCE-ID
 * naming no occurrence is the shape of a stale client acting on a series
 * somebody has since edited, and writing an override or an EXDATE for a slot
 * the rule never produces leaves a resource nothing can reconcile afterwards.
 */
export const findOccurrence = (
	calendar: ParsedCalendar,
	collectionTimezone: string,
	recurrenceId: string,
): CalendarResult<FoundOccurrence> => {
	const targetMs = Date.parse(recurrenceId);
	if (Number.isNaN(targetMs)) {
		return calendarFailure(
			"InvalidDateTime",
			`"${recurrenceId}" is not a RECURRENCE-ID this server can read`,
		);
	}
	const targetUtc = toUtcIso(targetMs);

	const overrideBySlot = overridesBySlot(calendar, collectionTimezone);
	const masterStartTzid = dtStartTzid(calendar.master);
	const event = new ICAL.Event(calendar.master);
	for (const override of calendar.overrides) {
		event.relateException(override);
	}

	const iterator = event.iterator();
	let next = iterator.next();
	let index = 0;
	while (next && index < CALENDAR_WINDOW_MAX_STEPS) {
		const slot = resolveTime(next, masterStartTzid, collectionTimezone);
		if (slot.isoUtc === targetUtc) {
			return {
				ok: true,
				value: {
					slot: next.clone(),
					slotUtc: slot.isoUtc,
					details: event.getOccurrenceDetails(next),
					index,
					override: overrideBySlot.get(slot.isoUtc) ?? null,
				},
			};
		}
		if (slot.instantMs > targetMs) break;
		index += 1;
		next = iterator.next();
	}

	// An override the rule never reaches is still an occurrence somebody can
	// see, so it is still one they can edit or drop.
	const stranded = overrideBySlot.get(targetUtc);
	const strandedSlot = stranded?.getFirstPropertyValue("recurrence-id");
	if (stranded && strandedSlot instanceof ICAL.Time) {
		return {
			ok: true,
			value: {
				slot: strandedSlot.clone(),
				slotUtc: targetUtc,
				details: null,
				index: -1,
				override: stranded,
			},
		};
	}

	return calendarFailure(
		"UnknownOccurrence",
		`this series has no occurrence at ${recurrenceId}`,
	);
};

const slotUtcOf = (
	override: ICAL.Component,
	collectionTimezone: string,
): string => {
	const recurrenceId = override.getFirstPropertyValue("recurrence-id");
	if (!(recurrenceId instanceof ICAL.Time)) return "";
	return resolveTime(recurrenceId, dtStartTzid(override), collectionTimezone)
		.isoUtc;
};

/** Drops the override VEVENTs on one side of a split point. */
const keepOverrides = (
	calendar: ParsedCalendar,
	collectionTimezone: string,
	keep: (slotMs: number) => boolean,
): void => {
	const kept: ICAL.Component[] = [];
	for (const override of calendar.overrides) {
		const slot = slotUtcOf(override, collectionTimezone);
		if (slot !== "" && keep(Date.parse(slot))) {
			kept.push(override);
			continue;
		}
		calendar.component.removeSubcomponent(override);
	}
	calendar.overrides = kept;
};

/** Drops the values of one repeating date property on a side of a split point. */
const keepDateValues = (
	master: ICAL.Component,
	name: string,
	collectionTimezone: string,
	keep: (slotMs: number) => boolean,
): void => {
	for (const property of master.getAllProperties(name)) {
		const kept = property.getValues().filter((value: unknown) => {
			if (!(value instanceof ICAL.Time)) return true;
			return keep(
				resolveTime(value, dtStartTzid(master), collectionTimezone).instantMs,
			);
		});
		if (kept.length === 0) {
			master.removeProperty(property);
			continue;
		}
		property.setValues(kept);
	}
};

/**
 * The last value the truncated series still covers, in the frame its own
 * DTSTART is written in.
 *
 * UNTIL has to be comparable to the values the rule produces, and an expander
 * compares them as they are written rather than as this server resolves them.
 * A UTC instant against a floating or all-day series is therefore off by the
 * collection's offset, and in a zone behind UTC that leaves the split
 * occurrence in both halves of the split. So the value is derived from the slot
 * itself: a date for a date series, the same wall clock for a floating one, and
 * UTC where the slot really is an instant — which is also what RFC 5545 3.3.10
 * asks for in each of those cases.
 */
const untilBefore = (slot: ICAL.Time): ICAL.Time => {
	const until = slot.clone();
	if (until.isDate) {
		until.adjust(-1, 0, 0, 0);
		return until;
	}
	until.adjust(0, 0, 0, -1);
	return until.zone === ICAL.Timezone.localTimezone
		? until
		: until.convertToZone(ICAL.Timezone.utcTimezone);
};

/**
 * Ends the master's rule just before an occurrence.
 *
 * A COUNT rule is truncated by count and an open or UNTIL rule by UNTIL,
 * because rewriting one as the other changes what the series means: a rule
 * counting ten meetings and a rule running to a date agree today and stop
 * agreeing the moment anything is added to or dropped from the series.
 */
const truncateRule = (
	master: ICAL.Component,
	occurrence: FoundOccurrence,
): void => {
	const property = master.getFirstProperty("rrule");
	if (!property) return;
	const rule = property.getFirstValue();
	if (!(rule instanceof ICAL.Recur)) return;

	if (rule.count !== null && occurrence.index >= 0) {
		rule.count = occurrence.index;
		rule.until = null;
	} else {
		rule.until = untilBefore(occurrence.slot);
		rule.count = null;
	}
	property.setValue(rule);
};

/** The rule the remainder of a split series carries. */
const applyRemainderRule = (
	master: ICAL.Component,
	occurrence: FoundOccurrence,
): void => {
	const property = master.getFirstProperty("rrule");
	if (!property) return;
	const rule = property.getFirstValue();
	if (!(rule instanceof ICAL.Recur)) return;
	if (rule.count === null || occurrence.index < 0) return;
	rule.count = Math.max(rule.count - occurrence.index, 1);
	property.setValue(rule);
};

const replaceWith = (calendar: ParsedCalendar): ScopedWrite => ({
	kind: "Replace",
	icalData: serializeCalendar(calendar.component),
});

const applyToMaster = async (
	calendar: ParsedCalendar,
	collectionTimezone: string,
	patch: Partial<CalendarEventFields>,
): Promise<CalendarResult<ScopedWrite>> => {
	const applied = await applyEventFields(
		calendar.master,
		patch,
		collectionTimezone,
	);
	if (!applied.ok) return applied;
	return { ok: true, value: replaceWith(calendar) };
};

const touchesTime = (patch: Partial<CalendarEventFields>): boolean =>
	patch.start !== undefined ||
	patch.end !== undefined ||
	patch.allDay !== undefined ||
	patch.timeZone !== undefined;

const civilDay = (time: ICAL.Time): number =>
	Date.UTC(time.year, time.month - 1, time.day) / 86_400_000;

const shiftProperty = (
	component: ICAL.Component,
	name: string,
	days: number,
): void => {
	const property = component.getFirstProperty(name);
	const value = property?.getFirstValue();
	if (!property || !(value instanceof ICAL.Time)) return;
	const shifted = value.clone();
	shifted.adjust(days, 0, 0, 0);
	property.setValue(shifted);
};

const shownStart = (occurrence: FoundOccurrence): ICAL.Time | null => {
	if (occurrence.details) return occurrence.details.startDate;
	const start = occurrence.override?.getFirstPropertyValue("dtstart");
	return start instanceof ICAL.Time ? start : null;
};

const reslot = (
	value: ICAL.Time,
	before: ICAL.Time,
	after: ICAL.Time,
): ICAL.Time => {
	const moved = after.clone();
	moved.adjust(civilDay(value) - civilDay(before), 0, 0, 0);
	return moved;
};

interface SeriesShape {
	start: ICAL.Time;
	tzid: string;
	rule: ICAL.Recur | null;
	durationSeconds: number;
}

interface SeriesSlot {
	time: ICAL.Time;
	instantMs: number;
}

const seriesShape = (master: ICAL.Component): SeriesShape | null => {
	const start = master.getFirstPropertyValue("dtstart");
	if (!(start instanceof ICAL.Time)) return null;
	const rule = master.getFirstPropertyValue("rrule");
	return {
		start: start.clone(),
		tzid: dtStartTzid(master),
		rule: rule instanceof ICAL.Recur ? rule.clone() : null,
		durationSeconds: new ICAL.Event(master).duration.toSeconds(),
	};
};

const ruleSlots = (
	shape: SeriesShape,
	collectionTimezone: string,
	stop: (instantMs: number, count: number) => boolean,
): SeriesSlot[] => {
	if (!shape.rule) return [];
	const slots: SeriesSlot[] = [];
	const iterator = shape.rule.iterator(shape.start);
	let next: ICAL.Time | null = iterator.next();
	while (next && slots.length < CALENDAR_WINDOW_MAX_STEPS) {
		const instantMs = resolveTime(
			next,
			shape.tzid,
			collectionTimezone,
		).instantMs;
		if (stop(instantMs, slots.length)) break;
		slots.push({ time: next.clone(), instantMs });
		next = iterator.next();
	}
	return slots;
};

const WEEKDAYS: readonly string[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

const BY_WEEKDAY = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/;

interface ByWeekday {
	ordinal: number;
	weekday: number;
}

const readByWeekday = (value: string): ByWeekday | null => {
	const match = BY_WEEKDAY.exec(value);
	if (!match) return null;
	return {
		ordinal: Number(match[1] ?? 0),
		weekday: WEEKDAYS.indexOf(match[2] ?? ""),
	};
};

const weekdayOf = (time: ICAL.Time): number => time.dayOfWeek() - 1;

const ordinalOf = (
	position: number,
	length: number,
	fromEnd: boolean,
	withinMonth: boolean,
): number => {
	const fromStart = Math.floor((position - 1) / 7) + 1;
	const fromLast = -(Math.floor((length - position) / 7) + 1);
	const preferred = fromEnd ? fromLast : fromStart;
	if (!withinMonth || Math.abs(preferred) < 5) return preferred;
	return fromEnd ? fromStart : fromLast;
};

const unmovable = <T>(
	rule: ICAL.Recur,
	after: ICAL.Time,
	reason: string,
): CalendarResult<T> =>
	calendarFailure(
		"UnmovableRecurrenceRule",
		`the repeat rule ${rule.toString()} ${reason}, so it cannot follow the series to ${after.toString().slice(0, 10)} — send a recurrenceRule for the new day in the same edit, or move one occurrence with scope=This`,
	);

const followStart = (
	rule: ICAL.Recur,
	before: ICAL.Time,
	after: ICAL.Time,
): CalendarResult<ICAL.Recur> => {
	if (civilDay(after) === civilDay(before)) return { ok: true, value: rule };
	const moved = rule.clone();
	const parts = moved.parts;

	const pinned = (["BYSETPOS", "BYYEARDAY", "BYWEEKNO"] as const).find(
		(name) => (parts[name]?.length ?? 0) > 0,
	);
	if (pinned) return unmovable(rule, after, `picks its days with ${pinned}`);

	const byMonthDay = parts.BYMONTHDAY ?? [];
	if (byMonthDay.length > 0) {
		if (byMonthDay.length !== 1 || byMonthDay[0] !== before.day) {
			return unmovable(rule, after, "names days of the month of its own");
		}
		parts.BYMONTHDAY = [after.day];
	}

	const byMonth = parts.BYMONTH ?? [];
	if (byMonth.length > 0 && after.month !== before.month) {
		if (byMonth.length !== 1 || byMonth[0] !== before.month) {
			return unmovable(rule, after, "names months of its own");
		}
		parts.BYMONTH = [after.month];
	}

	const byDay = parts.BYDAY ?? [];
	const weekdays = byDay
		.map(readByWeekday)
		.filter((weekday): weekday is ByWeekday => weekday !== null);
	if (weekdays.length !== byDay.length) {
		return unmovable(rule, after, "names a weekday this server cannot read");
	}
	if (weekdays.length === 0) return { ok: true, value: moved };

	const numbered = weekdays.find((weekday) => weekday.ordinal !== 0);
	if (numbered) {
		if (weekdays.length !== 1) {
			return unmovable(rule, after, "names more than one numbered weekday");
		}
		const withinMonth =
			moved.freq !== "YEARLY" || (parts.BYMONTH?.length ?? 0) > 0;
		const position = withinMonth ? after.day : after.dayOfYear();
		const length = withinMonth
			? ICAL.Time.daysInMonth(after.month, after.year)
			: ICAL.Time.isLeapYear(after.year)
				? 366
				: 365;
		const ordinal = ordinalOf(
			position,
			length,
			numbered.ordinal < 0,
			withinMonth,
		);
		parts.BYDAY = [`${ordinal}${WEEKDAYS[weekdayOf(after)]}`];
		return { ok: true, value: moved };
	}

	const shift = (((weekdayOf(after) - weekdayOf(before)) % 7) + 7) % 7;
	if (moved.interval > 1 && weekdays.length > 1) {
		const weekStart = moved.wkst - 1;
		const wraps = weekdays.map(
			(weekday) => ((weekday.weekday - weekStart + 7) % 7) + shift >= 7,
		);
		if (wraps.some((wrap) => wrap !== wraps[0])) {
			return unmovable(
				rule,
				after,
				"repeats on several days every few weeks, and the move carries some of them into another week",
			);
		}
	}
	parts.BYDAY = weekdays.map(
		(weekday) => WEEKDAYS[(weekday.weekday + shift) % 7] ?? "",
	);
	return { ok: true, value: moved };
};

const followRule = (
	master: ICAL.Component,
	before: SeriesShape,
): CalendarResult<null> => {
	const property = master.getFirstProperty("rrule");
	const rule = property?.getFirstValue();
	const start = master.getFirstPropertyValue("dtstart");
	if (!property || !(rule instanceof ICAL.Recur)) {
		return { ok: true, value: null };
	}
	if (!(start instanceof ICAL.Time)) return { ok: true, value: null };
	const followed = followStart(rule, before.start, start);
	if (!followed.ok) return followed;
	property.setValue(followed.value);
	return { ok: true, value: null };
};

const replaceTime = (
	component: ICAL.Component,
	name: string,
	time: ICAL.Time,
	tzid: string,
): void => {
	component.removeAllProperties(name);
	component.addProperty(timeProperty(name, time, tzid));
};

const followSlots = (
	calendar: ParsedCalendar,
	collectionTimezone: string,
	before: SeriesShape,
	after: SeriesShape,
): void => {
	const instantOf = (value: ICAL.Time, tzid: string): number =>
		resolveTime(value, tzid, collectionTimezone).instantMs;

	const exceptionInstants: number[] = [];
	for (const override of calendar.overrides) {
		const property = override.getFirstProperty("recurrence-id");
		const value = property?.getFirstValue();
		if (value instanceof ICAL.Time) {
			exceptionInstants.push(instantOf(value, tzidOf(property)));
		}
	}
	for (const property of calendar.master.getAllProperties("exdate")) {
		for (const value of property.getValues()) {
			if (value instanceof ICAL.Time) {
				exceptionInstants.push(instantOf(value, tzidOf(property)));
			}
		}
	}
	const latest = Math.max(Number.NEGATIVE_INFINITY, ...exceptionInstants);

	const previous = ruleSlots(
		before,
		collectionTimezone,
		(instantMs) => instantMs > latest,
	);
	const indexByInstant = new Map(
		previous.map((slot, index) => [slot.instantMs, index]),
	);
	const next = ruleSlots(
		after,
		collectionTimezone,
		(_instantMs, count) => count >= previous.length,
	);
	const moved = (value: ICAL.Time, tzid: string): ICAL.Time => {
		const index = indexByInstant.get(instantOf(value, tzid));
		const slot = index === undefined ? undefined : next[index];
		return slot ? slot.time.clone() : reslot(value, before.start, after.start);
	};

	for (const override of calendar.overrides) {
		const property = override.getFirstProperty("recurrence-id");
		const recurrenceId = property?.getFirstValue();
		if (!(recurrenceId instanceof ICAL.Time)) continue;
		const slot = moved(recurrenceId, tzidOf(property));
		const start = override.getFirstPropertyValue("dtstart");
		const untouched =
			start instanceof ICAL.Time &&
			instantOf(start, dtStartTzid(override)) ===
				instantOf(recurrenceId, tzidOf(property)) &&
			new ICAL.Event(override).duration.toSeconds() === before.durationSeconds;
		replaceTime(override, "recurrence-id", slot, after.tzid);
		if (!untouched) continue;
		const end = slot.clone();
		end.addDuration(ICAL.Duration.fromSeconds(after.durationSeconds));
		override.removeAllProperties("duration");
		replaceTime(override, "dtstart", slot, after.tzid);
		replaceTime(override, "dtend", end, after.tzid);
	}

	for (const name of ["exdate", "rdate"]) {
		for (const property of calendar.master.getAllProperties(name)) {
			const values = property.getValues();
			if (!values.every((value: unknown) => value instanceof ICAL.Time)) {
				continue;
			}
			const tzid = tzidOf(property);
			calendar.master.removeProperty(property);
			for (const value of values as ICAL.Time[]) {
				const target =
					name === "exdate"
						? moved(value, tzid)
						: reslot(value, before.start, after.start);
				calendar.master.addProperty(timeProperty(name, target, after.tzid));
			}
		}
	}
};

const occurrenceOffset = (
	calendar: ParsedCalendar,
	collectionTimezone: string,
	recurrenceId: string,
	seriesStart: ICAL.Time,
): CalendarResult<number> => {
	if (recurrenceId === "") return { ok: true, value: 0 };
	const found = findOccurrence(calendar, collectionTimezone, recurrenceId);
	if (!found.ok) return found;
	const shown = shownStart(found.value);
	if (!shown) {
		return calendarFailure(
			"UnknownOccurrence",
			`${recurrenceId} has no start to move the series from`,
		);
	}
	return { ok: true, value: civilDay(shown) - civilDay(seriesStart) };
};

const applyToSeries = async (
	calendar: ParsedCalendar,
	collectionTimezone: string,
	recurrenceId: string,
	patch: Partial<CalendarEventFields>,
): Promise<CalendarResult<ScopedWrite>> => {
	const before = seriesShape(calendar.master);
	if (!before) {
		return calendarFailure(
			"UnknownOccurrence",
			"this series has no start to move",
		);
	}
	const daysIn = occurrenceOffset(
		calendar,
		collectionTimezone,
		recurrenceId,
		before.start,
	);
	if (!daysIn.ok) return daysIn;

	const applied = await applyEventFields(
		calendar.master,
		patch,
		collectionTimezone,
	);
	if (!applied.ok) return applied;
	if (patch.start !== undefined) {
		shiftProperty(calendar.master, "dtstart", -daysIn.value);
	}
	if (patch.end !== undefined) {
		shiftProperty(calendar.master, "dtend", -daysIn.value);
	}
	if (patch.recurrenceRule === undefined) {
		const followed = followRule(calendar.master, before);
		if (!followed.ok) return followed;
	}

	const after = seriesShape(calendar.master);
	if (after) followSlots(calendar, collectionTimezone, before, after);
	return { ok: true, value: replaceWith(calendar) };
};

/**
 * The occurrence a `This` or `Following` write names, or `null` when the scope
 * collapses to the whole series — which is what "everything from the first
 * occurrence on" means.
 */
const anchorOf = (
	calendar: ParsedCalendar,
	collectionTimezone: string,
	input: ScopedWriteInput,
): CalendarResult<FoundOccurrence | null> => {
	if (!hasRecurrence(calendar)) {
		return calendarFailure(
			"NotRecurring",
			"this event happens once, so there is no occurrence to single out — use scope=All",
		);
	}
	if (input.recurrenceId === "") {
		return calendarFailure(
			"MissingRecurrenceId",
			`scope=${input.scope} needs the recurrenceId of the occurrence it applies to`,
		);
	}

	const found = findOccurrence(
		calendar,
		collectionTimezone,
		input.recurrenceId,
	);
	if (!found.ok) return found;
	if (input.scope !== RecurrenceScope.Following) {
		return { ok: true, value: found.value };
	}
	if (found.value.index === 0) return { ok: true, value: null };
	if (found.value.index < 0) {
		return calendarFailure(
			"UnknownOccurrence",
			`${input.recurrenceId} is a moved instance rather than a point in the rule, so there is nothing to split there`,
		);
	}
	return { ok: true, value: found.value };
};

/**
 * The override VEVENT for one occurrence, built from the master when the
 * resource does not already carry one.
 */
const overrideFor = async (
	calendar: ParsedCalendar,
	occurrence: FoundOccurrence,
): Promise<CalendarResult<ICAL.Component>> => {
	if (occurrence.override) return { ok: true, value: occurrence.override };

	const clone = await cloneCalendar(calendar);
	if (!clone.ok) return clone;
	const override = clone.value.master;
	for (const name of ["rrule", "rdate", "exdate"]) {
		override.removeAllProperties(name);
	}

	const tzid = dtStartTzid(calendar.master);
	override.addProperty(timeProperty("recurrence-id", occurrence.slot, tzid));
	if (occurrence.details) {
		setTimeValue(override, "dtstart", occurrence.details.startDate, tzid);
		if (override.hasProperty("dtend")) {
			setTimeValue(override, "dtend", occurrence.details.endDate, tzid);
		}
	}

	calendar.component.addSubcomponent(override);
	calendar.overrides.push(override);
	return { ok: true, value: override };
};

/**
 * Turns an edit of one drawing of a series into the resource writes it means.
 *
 * `All` rewrites the master, moved from the occurrence it names when it names
 * one. `This` writes a RECURRENCE-ID override, which is
 * the only thing iCalendar has for "this one is different". `Following` splits,
 * because a rule cannot change halfway through.
 */
export const applyScopedUpdate = async (
	calendar: ParsedCalendar,
	collectionTimezone: string,
	input: ScopedWriteInput,
	patch: Partial<CalendarEventFields>,
): Promise<CalendarResult<ScopedWrite>> => {
	if (input.scope === RecurrenceScope.All) {
		if (!hasRecurrence(calendar) || !touchesTime(patch)) {
			return applyToMaster(calendar, collectionTimezone, patch);
		}
		return applyToSeries(
			calendar,
			collectionTimezone,
			input.recurrenceId,
			patch,
		);
	}

	const anchored = anchorOf(calendar, collectionTimezone, input);
	if (!anchored.ok) return anchored;
	if (anchored.value === null) {
		return applyToMaster(calendar, collectionTimezone, patch);
	}
	const occurrence = anchored.value;

	if (input.scope === RecurrenceScope.This) {
		const override = await overrideFor(calendar, occurrence);
		if (!override.ok) return override;
		// A rule belongs to a series; an override is one occurrence of it and
		// carries no rule of its own.
		const { recurrenceRule: _seriesOnly, ...occurrencePatch } = patch;
		const applied = await applyEventFields(
			override.value,
			occurrencePatch,
			collectionTimezone,
		);
		if (!applied.ok) return applied;
		return { ok: true, value: replaceWith(calendar) };
	}

	const splitMs = Date.parse(occurrence.slotUtc);
	const tail = await cloneCalendar(calendar);
	if (!tail.ok) return tail;

	const before = (slotMs: number) => slotMs < splitMs;
	const fromHere = (slotMs: number) => slotMs >= splitMs;

	truncateRule(calendar.master, occurrence);
	keepOverrides(calendar, collectionTimezone, before);
	keepDateValues(calendar.master, "rdate", collectionTimezone, before);
	keepDateValues(calendar.master, "exdate", collectionTimezone, before);

	applyRemainderRule(tail.value.master, occurrence);
	keepOverrides(tail.value, collectionTimezone, fromHere);
	keepDateValues(tail.value.master, "rdate", collectionTimezone, fromHere);
	keepDateValues(tail.value.master, "exdate", collectionTimezone, fromHere);

	const tzid = dtStartTzid(tail.value.master);
	const tailEnd = occurrence.slot.clone();
	tailEnd.addDuration(new ICAL.Event(tail.value.master).duration);
	setTimeValue(tail.value.master, "dtstart", occurrence.slot, tzid);
	if (tail.value.master.hasProperty("dtend")) {
		setTimeValue(tail.value.master, "dtend", tailEnd, tzid);
	}
	for (const component of [tail.value.master, ...tail.value.overrides]) {
		component.removeAllProperties("uid");
		component.addPropertyWithValue("uid", input.followingUid);
	}

	const applied = await applyEventFields(
		tail.value.master,
		patch,
		collectionTimezone,
	);
	if (!applied.ok) return applied;

	return {
		ok: true,
		value: {
			kind: "Split",
			icalData: serializeCalendar(calendar.component),
			following: serializeCalendar(tail.value.component),
		},
	};
};

/**
 * Turns a delete of one drawing of a series into the resource writes it means.
 *
 * `This` is an EXDATE and `Following` truncates the rule; neither removes the
 * resource, because the rest of the series is still somebody's calendar. `All`
 * removes it.
 */
export const applyScopedDelete = async (
	calendar: ParsedCalendar,
	collectionTimezone: string,
	input: ScopedWriteInput,
): Promise<CalendarResult<ScopedWrite>> => {
	if (input.scope === RecurrenceScope.All) {
		return { ok: true, value: { kind: "Delete" } };
	}

	const anchored = anchorOf(calendar, collectionTimezone, input);
	if (!anchored.ok) return anchored;
	if (anchored.value === null) {
		return { ok: true, value: { kind: "Delete" } };
	}
	const occurrence = anchored.value;
	const splitMs = Date.parse(occurrence.slotUtc);

	if (input.scope === RecurrenceScope.Following) {
		const before = (slotMs: number) => slotMs < splitMs;
		truncateRule(calendar.master, occurrence);
		keepOverrides(calendar, collectionTimezone, before);
		keepDateValues(calendar.master, "rdate", collectionTimezone, before);
		keepDateValues(calendar.master, "exdate", collectionTimezone, before);
		return { ok: true, value: replaceWith(calendar) };
	}

	if (occurrence.override) {
		calendar.component.removeSubcomponent(occurrence.override);
		calendar.overrides = calendar.overrides.filter(
			(override) => override !== occurrence.override,
		);
	}
	calendar.master.addProperty(
		timeProperty("exdate", occurrence.slot, dtStartTzid(calendar.master)),
	);
	return { ok: true, value: replaceWith(calendar) };
};
