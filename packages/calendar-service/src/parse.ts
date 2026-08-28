import ICAL from "ical.js";
import { type CalendarResult, calendarFailure } from "./errors.js";

/** Components a VEVENT-only collection accepts at the top level of a resource. */
const ACCEPTED_COMPONENTS = new Set(["vevent", "vtimezone"]);

export interface ParsedCalendar {
	/** The VCALENDAR, with every property and component the input carried. */
	component: ICAL.Component;
	/** The VEVENT without a RECURRENCE-ID. */
	master: ICAL.Component;
	/** The VEVENTs carrying a RECURRENCE-ID, in document order. */
	overrides: ICAL.Component[];
	uid: string;
}

/**
 * Serializes a VCALENDAR back to iCalendar text.
 *
 * Lossless by construction: ical.js keeps every property it parsed, including
 * ones it has no design rule for, so an X- property or a whole unknown
 * component survives the round trip. The output is always CRLF (RFC 5545 3.1),
 * whatever the input used.
 *
 * The write path does not call this. A resource is stored as the bytes it
 * arrived in — LF-only ones included — because the etag is a digest of exactly
 * what the writer sent; running a stored resource through here would rewrite
 * its line endings, refold its long lines, and move the tag of a resource
 * nobody edited. This is for building a VCALENDAR, not for keeping one.
 */
export const serializeCalendar = (component: ICAL.Component): string =>
	component.toString();

/**
 * ical.js's parser in a promise, so unreadable bytes arrive as a rejection to
 * branch on rather than a synchronous throw.
 */
const readComponent = (
	icalData: string,
): Promise<CalendarResult<ICAL.Component>> =>
	new Promise<ICAL.Component>((resolve) => {
		resolve(new ICAL.Component(ICAL.parse(icalData)));
	}).then(
		(component) => ({ ok: true, value: component }) as const,
		(error: unknown) =>
			calendarFailure<ICAL.Component>(
				"MalformedIcalendar",
				error instanceof Error ? error.message : "unreadable iCalendar data",
			),
	);

/**
 * Reads and validates a VCALENDAR carrying exactly one event.
 *
 * Every refusal is a returned value. The input is client-supplied bytes, so a
 * malformed resource is an ordinary outcome of this function rather than a
 * fault.
 */
export const parseCalendar = async (
	icalData: string,
): Promise<CalendarResult<ParsedCalendar>> => {
	const read = await readComponent(icalData);
	if (!read.ok) return read;
	const component = read.value;

	if (component.name !== "vcalendar") {
		return calendarFailure(
			"NotACalendar",
			`expected a VCALENDAR, found ${component.name.toUpperCase()}`,
		);
	}

	const unsupported = component
		.getAllSubcomponents()
		.map((child) => child.name)
		.find((name) => !ACCEPTED_COMPONENTS.has(name));
	if (unsupported) {
		return calendarFailure(
			"UnsupportedComponent",
			`this calendar stores VEVENT only, and the resource carries a ${unsupported.toUpperCase()}`,
		);
	}

	const events = component.getAllSubcomponents("vevent");
	if (events.length === 0) {
		return calendarFailure("NoEvent", "the resource carries no VEVENT");
	}

	const masters = events.filter((event) => !event.hasProperty("recurrence-id"));
	if (masters.length === 0) {
		return calendarFailure(
			"NoMasterEvent",
			"every VEVENT carries a RECURRENCE-ID, so there is no event for them to override",
		);
	}
	if (masters.length > 1) {
		return calendarFailure(
			"MultipleMasterEvents",
			`one resource holds one event, and this one holds ${masters.length}`,
		);
	}

	const master = masters[0] as ICAL.Component;
	const uid = master.getFirstPropertyValue("uid");
	if (typeof uid !== "string" || uid === "") {
		return calendarFailure("MissingUid", "the VEVENT declares no UID");
	}

	const mismatched = events.find(
		(event) => event.getFirstPropertyValue("uid") !== uid,
	);
	if (mismatched) {
		return calendarFailure(
			"MismatchedUid",
			"the VEVENTs in this resource declare different UIDs",
		);
	}

	if (!master.hasProperty("dtstart")) {
		return calendarFailure("MissingDtStart", "the VEVENT declares no DTSTART");
	}

	return {
		ok: true,
		value: {
			component,
			master,
			overrides: events.filter((event) => event.hasProperty("recurrence-id")),
			uid,
		},
	};
};
