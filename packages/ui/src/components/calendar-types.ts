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
	/**
	 * The reader's own reply. Kept apart from `attendees`: how an event is drawn
	 * turns on what you said, not on what somebody else said.
	 */
	myRsvp: RsvpState;
	/** The thread this event came from; empty when it was typed by hand. */
	threadId: string;
	threadSubject: string;
	/** IANA zone, or empty when the source never said. */
	timeZone: string;
	zoneCertainty: ZoneCertainty;
	/** The rule in words — "Every weekday, 09:15". Empty when it does not repeat. */
	recurrenceRule: string;
	/** Groups every instance of one series under a single object. */
	seriesId: string;
	/**
	 * This instance was moved or rewritten away from the rule and no longer
	 * matches it. The series still owns it, so the next edit still asks scope.
	 */
	seriesException: boolean;
	status: "confirmed" | "tentative";
}

/**
 * One day, with everything on it already sorted and measured. The surfaces that
 * render a day take this rather than a flat event list, so the arithmetic is
 * done once by whoever owns the events.
 */
export interface CalendarDay {
	/** `YYYY-MM-DD`. */
	date: string;
	weekdayLabel: string;
	dayNumber: number;
	isToday: boolean;
	/** Ascending by start. */
	timed: CalendarEventData[];
	allDay: CalendarEventData[];
	/** Minutes of the day covered by at least one timed event. */
	busyMinutes: number;
	/**
	 * Every pile-up on the day: one group per event that something else runs
	 * into, holding that event and everything overlapping it. Members all meet
	 * the event the group is built around, not necessarily each other — which is
	 * what a grid has to lay out. Empty when the day is clean.
	 */
	conflicts: string[][];
}

/** An empty slot a reader picked, wherever they picked it — a grid, a list. */
export interface CalendarSlotPick {
	/** `YYYY-MM-DD`. */
	date: string;
	/** `HH:MM`, empty when the pick landed in the all-day band. */
	startTime: string;
	endTime: string;
	allDay: boolean;
}

/** One reading of a phrase the parser could not settle on its own. */
export interface PhraseChoiceOption {
	id: string;
	label: string;
	/** Empty leaves the reading from the rest of the sentence alone. */
	date: string;
	startTime: string;
}

export interface PhraseChoice {
	id: string;
	question: string;
	/** The words the question is about. */
	source: string;
	options: PhraseChoiceOption[];
	chosenId: string;
}

/**
 * What a reader made of a typed sentence, with the words each reading came
 * from. Every field is presentational: the composer renders it and never parses
 * anything itself, so a parser can be swapped without touching the surface.
 */
export interface AgendaParse {
	title: string;
	date: string;
	dateText: string;
	startTime: string;
	startTimeText: string;
	endTime: string;
	durationMinutes: number;
	durationText: string;
	attendees: string[];
	attendeesText: string;
	location: string;
	locationText: string;
	/** Human-readable rule, empty for a one-off. */
	repeat: string;
	repeatText: string;
	/** Defaults the reader applied on its own authority. */
	assumptions: string[];
	/** What the sentence never said. */
	unresolved: string[];
	/** What the sentence said two ways. */
	choices: PhraseChoice[];
}

/** Choice id → option id, as answered by the person typing. */
export type ChoicePicks = Readonly<Record<string, string>>;

/**
 * One clock a zoneless time could be on. Present only when the source genuinely
 * did not say which, and the reader is the one who settles it.
 */
export interface ZoneOption {
	/** IANA zone, and the identity of the choice. */
	timeZone: string;
	/** The time as this clock reads it — "20:25 in Lisbon". */
	label: string;
	/** What that means on the reader's own clock. */
	note: string;
}

/**
 * The clocks a zoneless time could be on. Never empty: a question with no
 * answers is a card the reader can look at and never get past, so having no
 * question to ask is the absent list, not the empty one.
 */
export type ZoneOptions = readonly [ZoneOption, ...ZoneOption[]];

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
	/** The address a rule about this sender is written against. */
	senderAddress: string;
	/** 0–1. The component derives its own wording; the seam carries the value. */
	confidence: number;
	/** What the parse could not settle, empty when nothing. */
	ambiguity: string;
	suggestedCalendarId: string;
	timeZone: string;
	zoneCertainty: ZoneCertainty;
	/**
	 * The clocks the time could be on. Absent when the source said which, which
	 * is the only case where `timeZone` above can be trusted on its own.
	 */
	zoneOptions?: ZoneOptions;
}

/**
 * The rung of the reading ladder that answered. Deterministic readings run
 * first — an attached invitation, then machine-readable markup — and only what
 * neither settles is left to a pattern in the prose. A field the sender stated
 * and a phrase software interpreted are not the same claim, so every surface
 * that shows a reading also says which rung produced it.
 */
export type CalendarParseMethod = "ics" | "markup" | "pattern";

/**
 * Where an invitation stands. `superseded` is a later message carrying a higher
 * SEQUENCE for the same UID. `cancelled` is a METHOD:CANCEL that still needs
 * the reader to act, because nothing leaves the calendar without a person
 * saying so either.
 */
export type CalendarInviteState =
	| "pending"
	| "answered"
	| "superseded"
	| "cancelled";

/** An invitation as it arrived, before any of it reaches a calendar. */
export interface CalendarInvite {
	id: string;
	/** The thread it came in on. The mail stays behind every calendar surface. */
	threadId: string;
	/** The event exactly as the organiser sent it — not yet on any calendar. */
	proposed: CalendarEventData;
	organizerName: string;
	organizerEmail: string;
	method: CalendarParseMethod;
	/** The field or phrase the reading rests on. */
	evidence: string;
	state: CalendarInviteState;
	/** iCalendar SEQUENCE. A higher one for the same UID supersedes this. */
	sequence: number;
}

/**
 * Something already agreed to that a candidate span runs into. The label is
 * written by the caller, which is the side that knows the calendar and the
 * account the clash sits on.
 */
export interface CalendarClash {
	id: string;
	label: string;
}

/** A time named in prose, already checked against the day it names. */
export interface CalendarProposal {
	id: string;
	/** The words in the mail, quoted back. */
	phrase: string;
	/** What is already booked over it; empty when nothing is. */
	clashTitle: string;
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
