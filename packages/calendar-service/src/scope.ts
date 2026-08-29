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
import { dtStartTzid, resolveTime, toUtcIso } from "./time.js";

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
	/** ISO 8601 UTC instant naming the occurrence; `""` outside `This`/`Following`. */
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
	splitMs: number,
): void => {
	const property = master.getFirstProperty("rrule");
	if (!property) return;
	const rule = property.getFirstValue();
	if (!(rule instanceof ICAL.Recur)) return;

	if (rule.count !== null && occurrence.index >= 0) {
		rule.count = occurrence.index;
		rule.until = null;
	} else {
		// UNTIL is inclusive (RFC 5545 3.3.10), so it names the last instant the
		// series still covers — a second before the occurrence being split off.
		rule.until = ICAL.Time.fromJSDate(new Date(splitMs - 1000), true);
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
 * `All` rewrites the master. `This` writes a RECURRENCE-ID override, which is
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
		return applyToMaster(calendar, collectionTimezone, patch);
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

	truncateRule(calendar.master, occurrence, splitMs);
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
		truncateRule(calendar.master, occurrence, splitMs);
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
