/**
 * A suggestion the server read out of a message, as the calendar kit draws it.
 *
 * The API carries projections of the invitation and nothing about who is
 * looking at it, so what the reader is asked — whether the card still wants an
 * answer, what the span runs into, which half-hours are open — is decided here,
 * in one place, rather than in each surface that shows a card.
 */
import type {
	RemitImapCalendarFreeBusySpan,
	RemitImapCalendarSuggestionResponse,
} from "@remit/api-http-client/types.gen.ts";
import {
	type CalendarClash,
	type CalendarEventData,
	type CalendarInvite,
	type CalendarInviteState,
	type CalendarSlotPick,
	type EventSuggestion,
	formatMinute,
	freeStretchesFromSpans,
	type RsvpState,
	type ZoneCertainty,
} from "@remit/ui";
import { busySpansByDate } from "@/hooks/calendar";
import {
	formatClock,
	formatDayLabel,
	formatEventWhen,
	formatInstantClock,
} from "./calendar-format";
import { isoDate } from "./calendar-route";

export type CalendarSuggestion = RemitImapCalendarSuggestionResponse;

/** Half an hour is what an offer of another time is worth. */
export const OFFER_MINUTES = 30;

/** More than a handful of offers is a timetable, not a reply. */
const OFFER_LIMIT = 6;

const ZONES: Record<CalendarSuggestion["zoneCertainty"], ZoneCertainty> = {
	Local: "local",
	Explicit: "explicit",
	Ambiguous: "ambiguous",
};

const AMBIGUOUS_ZONE =
	"The invitation named a time zone nothing could resolve, so this time may be hours out.";

/** Where the card stands, or nothing when there is no card left to draw. */
export interface InviteStanding {
	state: CalendarInviteState;
	rsvp: RsvpState;
}

/**
 * What a suggestion's state means for its card.
 *
 * A dismissed card was waved away and is gone. A cancellation asks for an
 * answer only while it is pending: once taken or kept, the event it named is
 * settled and there is nothing left to say beside the message.
 */
export function inviteStanding(
	suggestion: CalendarSuggestion,
): InviteStanding | undefined {
	if (suggestion.state === "Dismissed") return undefined;
	if (suggestion.method === "Cancel")
		return suggestion.state === "Pending"
			? { state: "cancelled", rsvp: "noReply" }
			: undefined;
	if (suggestion.state === "Superseded")
		return { state: "superseded", rsvp: "noReply" };
	if (suggestion.state === "Accepted")
		return { state: "answered", rsvp: "accepted" };
	if (suggestion.state === "Declined")
		return { state: "answered", rsvp: "declined" };
	if (suggestion.state === "Tentative")
		return { state: "answered", rsvp: "tentative" };
	return { state: "pending", rsvp: "noReply" };
}

export const isFromInvitation = (suggestion: CalendarSuggestion): boolean =>
	suggestion.source !== "TextHeuristic";

/** The day a suggestion lands on, on the clock this device reads. */
export function suggestionDate(suggestion: CalendarSuggestion): string {
	if (suggestion.allDay) return suggestion.dtStart.slice(0, 10);
	return isoDate(new Date(suggestion.dtStart));
}

export const suggestionTitle = (suggestion: CalendarSuggestion): string =>
	suggestion.summary === "" ? "Untitled event" : suggestion.summary;

export function suggestionWhen(suggestion: CalendarSuggestion): string {
	return formatEventWhen({
		start: suggestion.dtStart,
		end: suggestion.dtEnd,
		allDay: suggestion.allDay,
	});
}

export interface InviteContext {
	threadId: string;
	threadSubject: string;
	/** Who the mail came from, for an invitation that names no organiser. */
	senderName: string;
	calendarId: string;
}

function proposedEvent(
	suggestion: CalendarSuggestion,
	context: InviteContext,
): CalendarEventData {
	return {
		id: suggestion.suggestionId,
		calendarId: context.calendarId,
		title: suggestionTitle(suggestion),
		start: suggestion.dtStart,
		end: suggestion.dtEnd,
		allDay: suggestion.allDay,
		location: suggestion.location,
		notes: "",
		attendees: [],
		myRsvp: "noReply",
		threadId: context.threadId,
		threadSubject: context.threadSubject,
		timeZone: "",
		zoneCertainty: ZONES[suggestion.zoneCertainty],
		recurrenceRule: "",
		seriesId: "",
		seriesException: false,
		status: "confirmed",
	};
}

export function toCalendarInvite(
	suggestion: CalendarSuggestion,
	state: CalendarInviteState,
	context: InviteContext,
): CalendarInvite {
	const organizer =
		suggestion.organizer === "" ? context.senderName : suggestion.organizer;
	return {
		id: suggestion.suggestionId,
		threadId: context.threadId,
		proposed: proposedEvent(suggestion, context),
		organizerName: organizer === "" ? "The sender" : organizer,
		organizerEmail: suggestion.organizer,
		method: "ics",
		evidence: "",
		state,
		sequence: suggestion.sequence,
	};
}

export function toEventSuggestion(
	suggestion: CalendarSuggestion,
	context: Omit<InviteContext, "senderName"> & { sender: string },
): EventSuggestion {
	return {
		id: suggestion.suggestionId,
		title: suggestionTitle(suggestion),
		start: suggestion.dtStart,
		end: suggestion.dtEnd,
		allDay: suggestion.allDay,
		location: suggestion.location,
		threadId: context.threadId,
		threadSubject: context.threadSubject,
		sender: context.sender,
		senderAddress: suggestion.organizer,
		confidence: isFromInvitation(suggestion) ? 1 : 0.6,
		ambiguity: suggestion.zoneCertainty === "Ambiguous" ? AMBIGUOUS_ZONE : "",
		suggestedCalendarId: context.calendarId,
		timeZone: "",
		zoneCertainty: ZONES[suggestion.zoneCertainty],
	};
}

const overlaps = (
	span: { start: string; end: string },
	busy: RemitImapCalendarFreeBusySpan,
): boolean =>
	Date.parse(busy.start) < Date.parse(span.end) &&
	Date.parse(busy.end) > Date.parse(span.start);

/**
 * What is already booked over a span. Busy time is merged across every
 * calendar on the server and carries no titles, so a clash names the hours it
 * takes rather than the meeting in them.
 */
export function clashesOver(
	span: { start: string; end: string },
	busy: readonly RemitImapCalendarFreeBusySpan[],
): CalendarClash[] {
	return busy
		.filter((entry) => overlaps(span, entry))
		.map((entry) => ({
			id: `${entry.start}/${entry.end}`,
			label: `Busy ${formatInstantClock(entry.start)} – ${formatInstantClock(entry.end)}`,
		}));
}

/** Half-hours still open on a day, cut out of the busy time the server merged. */
export function slotOffersOn(
	date: string,
	busy: readonly RemitImapCalendarFreeBusySpan[],
): CalendarSlotPick[] {
	const spans = busySpansByDate([date], busy).get(date) ?? [];
	const offers: CalendarSlotPick[] = [];
	for (const stretch of freeStretchesFromSpans(date, spans, OFFER_MINUTES)) {
		for (
			let minute = stretch.startMinute;
			minute + OFFER_MINUTES <= stretch.endMinute &&
			offers.length < OFFER_LIMIT;
			minute += OFFER_MINUTES
		) {
			offers.push({
				date,
				endDate: date,
				startTime: formatMinute(minute),
				endTime: formatMinute(minute + OFFER_MINUTES),
				allDay: false,
			});
		}
	}
	return offers;
}

/** The picked half-hours as a line a reply can carry. */
export function slotsAsText(
	date: string,
	slots: readonly CalendarSlotPick[],
	picked: readonly string[],
): string {
	const times = slots
		.filter((slot) => picked.includes(slot.startTime))
		.map(
			(slot) => `${formatClock(slot.startTime)} – ${formatClock(slot.endTime)}`,
		);
	return `${formatDayLabel(date)}: ${times.join(", ")}`;
}
