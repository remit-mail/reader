/**
 * Why a VCALENDAR was refused. Every value names something the writer can act
 * on — a caller maps these to a 4xx and repeats the message.
 */
export type CalendarValidationCode =
	/** The bytes are not parseable iCalendar at all. */
	| "MalformedIcalendar"
	/** The document's root is not a VCALENDAR. */
	| "NotACalendar"
	/** A component this collection does not store, e.g. VTODO or VJOURNAL. */
	| "UnsupportedComponent"
	/** A VCALENDAR with no VEVENT in it. */
	| "NoEvent"
	/** No VEVENT without a RECURRENCE-ID: overrides with nothing to override. */
	| "NoMasterEvent"
	/** More than one VEVENT without a RECURRENCE-ID. */
	| "MultipleMasterEvents"
	/** A VEVENT with no UID, or an empty one. */
	| "MissingUid"
	/** VEVENTs in one resource declaring different UIDs. */
	| "MismatchedUid"
	/** A VEVENT with no DTSTART. */
	| "MissingDtStart"
	/** A VEVENT whose end precedes its start. */
	| "BackwardsEnd"
	/** A start or end that is not a date-time this server can read. */
	| "InvalidDateTime"
	/** A time zone name nothing on this platform resolves. */
	| "UnknownTimeZone"
	/** An RRULE value ical.js could not read. */
	| "InvalidRecurrenceRule"
	/** A scoped write that names one occurrence without saying which. */
	| "MissingRecurrenceId"
	/** A per-occurrence scope against an event that has one occurrence. */
	| "NotRecurring"
	/** A RECURRENCE-ID naming no occurrence this series produces. */
	| "UnknownOccurrence";

export interface CalendarValidationError {
	code: CalendarValidationCode;
	message: string;
}

/**
 * The outcome of reading a VCALENDAR. A refusal is a value, not a throw:
 * malformed input from a client is an expected outcome of this boundary, and
 * every caller has to render it rather than crash on it.
 */
export type CalendarResult<T> =
	| { ok: true; value: T }
	| { ok: false; error: CalendarValidationError };

export const calendarFailure = <T>(
	code: CalendarValidationCode,
	message: string,
): CalendarResult<T> => ({ ok: false, error: { code, message } });
