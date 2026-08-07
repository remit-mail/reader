/**
 * The shapes the calendar surfaces pass around. Presentational only: a
 * component here takes one of these and renders it, and every mutation leaves
 * through a callback. Nothing in this file knows where the data came from.
 */

/** One of the six per-calendar hues declared in `tokens.css`. */
export type CalendarColorId =
	| "cal-1"
	| "cal-2"
	| "cal-3"
	| "cal-4"
	| "cal-5"
	| "cal-6";

export const calendarColorIds: CalendarColorId[] = [
	"cal-1",
	"cal-2",
	"cal-3",
	"cal-4",
	"cal-5",
	"cal-6",
];

export type RsvpState = "accepted" | "tentative" | "declined" | "noReply";

export interface CalendarAttendee {
	name: string;
	email: string;
	rsvp: RsvpState;
	/** The one attendee who owns the invitation, if any is known. */
	role: "organizer" | "attendee";
}

export interface CalendarDescriptor {
	id: string;
	/** The mail account this calendar belongs to, so both nav trees line up. */
	accountId: string;
	accountLabel: string;
	name: string;
	color: CalendarColorId;
}

/**
 * How much the source told us about the zone. `ambiguous` is a first-class
 * state: a mail that said "3pm" and nothing else has no zone, and the UI says
 * so rather than assuming the reader's.
 */
export type ZoneCertainty = "local" | "explicit" | "ambiguous";

export interface CalendarEventData {
	id: string;
	calendarId: string;
	title: string;
	/** ISO 8601 with an explicit offset. */
	start: string;
	end: string;
	allDay: boolean;
	location: string;
	notes: string;
	attendees: CalendarAttendee[];
	/** The thread this event came from; empty when it was typed by hand. */
	threadId: string;
	threadSubject: string;
	/** IANA zone, or empty when the source never said. */
	timeZone: string;
	zoneCertainty: ZoneCertainty;
	/** Human-readable rule, empty when the event does not repeat. */
	recurrenceRule: string;
	/** Groups every instance of one series under a single object. */
	seriesId: string;
	status: "confirmed" | "tentative";
}

/**
 * A candidate read out of mail. It is deliberately not a `CalendarEventData`:
 * nothing reaches the grid until a person confirms it, so a suggestion cannot
 * be mistaken for an event by type, let alone by pixel.
 */
export interface EventSuggestion {
	id: string;
	title: string;
	start: string;
	end: string;
	allDay: boolean;
	location: string;
	/** The mail it was read out of. Always present — there is no other source. */
	threadId: string;
	threadSubject: string;
	sender: string;
	/** 0–1. The component derives its own wording; the seam carries the value. */
	confidence: number;
	/** What the parse could not settle, empty when nothing. */
	ambiguity: string;
	suggestedCalendarId: string;
	timeZone: string;
	zoneCertainty: ZoneCertainty;
}

/** Which instances of a series an edit applies to, chosen before the edit. */
export type RecurrenceScope = "this" | "following" | "all";

/**
 * The zoom levels of one continuous strip of time, widest first. They are not
 * separate screens: changing one keeps the date you were looking at.
 */
export type CalendarViewId = "year" | "month" | "week" | "day" | "agenda";

/** What the editor holds while an event is being written. */
export interface EventDraft {
	title: string;
	/** `YYYY-MM-DD`. */
	date: string;
	/** `HH:MM`, empty when the entry is all day. */
	startTime: string;
	endTime: string;
	allDay: boolean;
	calendarId: string;
	location: string;
	/** Free text, one guest per comma — the prototype does not resolve them. */
	guests: string;
	notes: string;
	/** Human-readable rule, empty for a one-off. */
	repeat: string;
}
