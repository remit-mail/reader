import type { CalendarObjectItem } from "@remit/data-ports";
import { CalendarEventStatus, CalendarTransparency } from "@remit/domain-enums";
import ICAL from "ical.js";
import { type CalendarResult, calendarFailure } from "./errors.js";
import { serializeCalendar } from "./parse.js";
import {
	civilInZone,
	dtEndTzid,
	dtStartTzid,
	isResolvableZone,
	resolveTime,
} from "./time.js";

/** Identifies this server in the PRODID of every VCALENDAR it writes. */
export const CALENDAR_PRODID = "-//Remit//Reader Calendar//EN";

/**
 * An event as a person describes it, before it is iCalendar.
 *
 * Deliberately not a subset of a VEVENT: a client should not have to know that
 * an all-day end is exclusive, that a duration and an end are the same fact
 * written twice, or that a zone lives in a parameter rather than in the value.
 * The server owns iCalendar; this is the shape the API takes and the shape a
 * patch is expressed in.
 */
export interface CalendarEventFields {
	summary: string;
	description: string;
	location: string;
	/** ISO 8601 with a zone offset, or `YYYY-MM-DD` when `allDay`. */
	start: string;
	/** Same form as `start`. Exclusive for an all-day event. */
	end: string;
	allDay: boolean;
	/** IANA zone the event is anchored in. `""` anchors it in UTC. */
	timeZone: string;
	status: CalendarObjectItem["status"];
	transparency: CalendarObjectItem["transparency"];
	/** RRULE value without the property name. `""` for a single event. */
	recurrenceRule: string;
}

const STATUS_TO_ICAL: Record<CalendarObjectItem["status"], string> = {
	[CalendarEventStatus.Confirmed]: "CONFIRMED",
	[CalendarEventStatus.Tentative]: "TENTATIVE",
	[CalendarEventStatus.Cancelled]: "CANCELLED",
};

const TRANSPARENCY_TO_ICAL: Record<CalendarObjectItem["transparency"], string> =
	{
		[CalendarTransparency.Opaque]: "OPAQUE",
		[CalendarTransparency.Transparent]: "TRANSPARENT",
	};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}/;

/**
 * An offset is required on a date-time. A wall time with no offset names no
 * instant — a client sending `2026-03-29T02:30:00` on the morning the clocks
 * move is asking for a time that happens twice, or not at all — and guessing
 * one is how a calendar quietly puts an event an hour out.
 */
const OFFSET_BEARING = /(Z|[+-]\d{2}:\d{2})$/;

/**
 * Reads one API date-time into the iCalendar time the resource will carry.
 *
 * An all-day value becomes a DATE, which is a civil date and has no zone at
 * all. A timed value becomes the wall time it reads as in `timeZone`, so the
 * resource records the zone the event is anchored in rather than the offset
 * that zone happened to be at — which is the whole difference between a weekly
 * 09:00 meeting and a meeting that moves to 08:00 every autumn.
 */
export const readEventTime = (
	value: string,
	allDay: boolean,
	timeZone: string,
): CalendarResult<ICAL.Time> => {
	if (allDay) {
		const date = DATE_ONLY.exec(value)?.[0];
		if (!date) {
			return calendarFailure(
				"InvalidDateTime",
				`an all-day event needs a YYYY-MM-DD date, and this one carries "${value}"`,
			);
		}
		const [year, month, day] = date.split("-").map(Number) as [
			number,
			number,
			number,
		];
		return {
			ok: true,
			value: ICAL.Time.fromData({ year, month, day, isDate: true }),
		};
	}

	if (!OFFSET_BEARING.test(value)) {
		return calendarFailure(
			"InvalidDateTime",
			`a date-time needs an explicit zone offset, and this one carries "${value}"`,
		);
	}
	const instantMs = Date.parse(value);
	if (Number.isNaN(instantMs)) {
		return calendarFailure(
			"InvalidDateTime",
			`"${value}" is not a date-time this server can read`,
		);
	}
	if (timeZone !== "" && !isResolvableZone(timeZone)) {
		return calendarFailure(
			"UnknownTimeZone",
			`"${timeZone}" is not a time zone this server can resolve`,
		);
	}

	const civil = civilInZone(instantMs, timeZone === "" ? "UTC" : timeZone);
	return {
		ok: true,
		value: ICAL.Time.fromData(
			{
				year: civil.year,
				month: civil.month,
				day: civil.day,
				hour: civil.hour,
				minute: civil.minute,
				second: civil.second,
				isDate: false,
			},
			timeZone === "" ? ICAL.Timezone.utcTimezone : ICAL.Timezone.localTimezone,
		),
	};
};

const setTimeProperty = (
	event: ICAL.Component,
	name: string,
	time: ICAL.Time,
	timeZone: string,
): void => {
	event.removeAllProperties(name);
	const property = new ICAL.Property(name);
	event.addProperty(property);
	property.setValue(time);
	if (!time.isDate && timeZone !== "") {
		property.setParameter("tzid", timeZone);
	}
};

const setTextProperty = (
	event: ICAL.Component,
	name: string,
	value: string,
): void => {
	event.removeAllProperties(name);
	if (value === "") return;
	event.addPropertyWithValue(name, value);
};

/** The time fields a stored VEVENT already carries, in the API's own form. */
export const eventTimeFields = (
	component: ICAL.Component,
	collectionTimezone: string,
): Pick<CalendarEventFields, "start" | "end" | "allDay" | "timeZone"> => {
	const event = new ICAL.Event(component);
	const startTzid = dtStartTzid(component);
	const start = resolveTime(event.startDate, startTzid, collectionTimezone);
	const end = resolveTime(
		event.endDate,
		dtEndTzid(component),
		collectionTimezone,
	);
	return {
		start: start.isoOffset,
		end: end.isoOffset,
		allDay: start.isDate,
		timeZone: startTzid,
	};
};

/**
 * ical.js's recurrence parser in a promise, so an unreadable rule arrives as a
 * value to branch on rather than a synchronous throw.
 */
export const readRecurrenceRule = (
	recurrenceRule: string,
): Promise<CalendarResult<ICAL.Recur>> =>
	new Promise<ICAL.Recur>((resolve) => {
		resolve(ICAL.Recur.fromString(recurrenceRule));
	}).then(
		(value) => ({ ok: true, value }) as const,
		(error: unknown) =>
			calendarFailure<ICAL.Recur>(
				"InvalidRecurrenceRule",
				error instanceof Error
					? error.message
					: `"${recurrenceRule}" is not a recurrence rule this server can read`,
			),
	);

/**
 * Writes a patch onto a VEVENT.
 *
 * A field the patch does not carry is untouched, so renaming an event moves
 * nothing. The time fields are the exception: zone, all-day-ness, start and end
 * are one fact between them, so touching any of them rewrites DTSTART and DTEND
 * together from the values the event would then have. Rewriting only the one
 * the caller named is what produces an event that starts in one zone and ends
 * in another.
 */
export const applyEventFields = async (
	component: ICAL.Component,
	patch: Partial<CalendarEventFields>,
	collectionTimezone: string,
): Promise<CalendarResult<null>> => {
	if (patch.summary !== undefined) {
		setTextProperty(component, "summary", patch.summary);
	}
	if (patch.description !== undefined) {
		setTextProperty(component, "description", patch.description);
	}
	if (patch.location !== undefined) {
		setTextProperty(component, "location", patch.location);
	}
	if (patch.status !== undefined) {
		setTextProperty(component, "status", STATUS_TO_ICAL[patch.status]);
	}
	if (patch.transparency !== undefined) {
		setTextProperty(
			component,
			"transp",
			TRANSPARENCY_TO_ICAL[patch.transparency],
		);
	}

	if (patch.recurrenceRule !== undefined) {
		component.removeAllProperties("rrule");
		if (patch.recurrenceRule !== "") {
			const rule = await readRecurrenceRule(patch.recurrenceRule);
			if (!rule.ok) return rule;
			component.addPropertyWithValue("rrule", rule.value);
		}
	}

	const touchesTime =
		patch.start !== undefined ||
		patch.end !== undefined ||
		patch.allDay !== undefined ||
		patch.timeZone !== undefined;
	if (!touchesTime) return { ok: true, value: null };

	// A VEVENT being built from nothing has no times to read back, and every one
	// of them is in the patch. The empty start then refuses a create that left
	// one out, which is the same answer reading it back would have given.
	const current = component.hasProperty("dtstart")
		? eventTimeFields(component, collectionTimezone)
		: { start: "", end: "", allDay: false, timeZone: "" };
	const allDay = patch.allDay ?? current.allDay;
	const timeZone = patch.timeZone ?? current.timeZone;
	const start = readEventTime(patch.start ?? current.start, allDay, timeZone);
	if (!start.ok) return start;
	const end = readEventTime(patch.end ?? current.end, allDay, timeZone);
	if (!end.ok) return end;

	// A duration says the same thing DTEND does, and leaving one behind beside a
	// rewritten DTEND leaves two answers to how long the event is.
	component.removeAllProperties("duration");
	setTimeProperty(component, "dtstart", start.value, timeZone);
	setTimeProperty(component, "dtend", end.value, timeZone);
	return { ok: true, value: null };
};

/**
 * Builds the VCALENDAR text for a new event.
 *
 * The output goes straight to the single write path, which parses it again to
 * validate and project it. That second read is not waste: it is the same gate
 * every other writer passes, so an event this function got wrong is refused
 * here rather than stored.
 */
export const buildEventCalendar = async (
	fields: CalendarEventFields,
	uid: string,
	now: Date = new Date(),
): Promise<CalendarResult<string>> => {
	const calendar = new ICAL.Component("vcalendar");
	calendar.addPropertyWithValue("version", "2.0");
	calendar.addPropertyWithValue("prodid", CALENDAR_PRODID);

	const event = new ICAL.Component("vevent");
	calendar.addSubcomponent(event);
	event.addPropertyWithValue("uid", uid);
	event.addPropertyWithValue("dtstamp", ICAL.Time.fromJSDate(now, true));

	const applied = await applyEventFields(event, fields, fields.timeZone);
	if (!applied.ok) return applied;

	return { ok: true, value: serializeCalendar(calendar) };
};
