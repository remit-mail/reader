/**
 * Writing a draft back onto events, and deciding how many events that is.
 *
 * Shared by the three calendar options so the answer to the scope question
 * means the same thing in all of them: a series is one object with instances,
 * and an edit either rewrites the object or takes one instance out of line.
 */
import type {
	CalendarAttendee,
	CalendarEventData,
	EventDraft,
	RecurrenceScope,
} from "@remit/ui";

/** June puts Amsterdam at UTC+2, and every fixture week is in June. */
const OFFSET = "+02:00";

function nextDay(date: string): string {
	const next = new Date(`${date}T00:00:00Z`);
	next.setUTCDate(next.getUTCDate() + 1);
	return next.toISOString().slice(0, 10);
}

/**
 * The guest field is a list of names, so a guest already on the event keeps the
 * whole record — the address that was invited, the reply that came back, who
 * organised it. Only a name that was not there before is a new person.
 */
export function guestsFrom(
	names: string,
	known: CalendarAttendee[],
): CalendarAttendee[] {
	return names
		.split(",")
		.map((name) => name.trim())
		.filter((name) => name !== "")
		.map(
			(name) =>
				known.find((attendee) => attendee.name === name) ?? {
					name,
					email: `${name.toLowerCase().replace(/\s+/g, ".")}@example`,
					rsvp: "noReply" as const,
					role: "attendee" as const,
				},
		);
}

/**
 * The draft holds only the fields the editor shows. Everything else — the
 * thread the event came out of, the series it belongs to, the zone the mail
 * gave, what everyone answered — comes off the event being edited, so saving an
 * edit never quietly destroys what the form never asked about.
 *
 * A rule set on an event with no series behind it mints one, so the next edit
 * of it asks scope the way an edit of the standup does.
 */
export function applyDraft(
	base: CalendarEventData,
	draft: EventDraft,
): CalendarEventData {
	return {
		...base,
		calendarId: draft.calendarId,
		title: draft.title === "" ? "(no title)" : draft.title,
		start: draft.allDay
			? draft.date
			: `${draft.date}T${draft.startTime}:00${OFFSET}`,
		end: draft.allDay
			? nextDay(draft.date)
			: `${draft.date}T${draft.endTime}:00${OFFSET}`,
		allDay: draft.allDay,
		location: draft.location,
		notes: draft.notes,
		attendees: guestsFrom(draft.guests, base.attendees),
		recurrenceRule: draft.repeat,
		seriesId:
			draft.repeat === ""
				? ""
				: base.seriesId === ""
					? `ser_${base.id}`
					: base.seriesId,
	};
}

/**
 * How far the edit reaches, given the answer the scope question got.
 *
 * "Just this one" leaves the series standing and marks the instance as no
 * longer matching its rule — the series still owns the morning, so the next
 * edit of it asks again. "This and following" and "the whole series" rewrite
 * the series in place: every instance takes the new title, time and calendar
 * while keeping the day it already sits on.
 */
export function applyScopedEdit(
	events: CalendarEventData[],
	eventId: string,
	draft: EventDraft,
	scope: RecurrenceScope | "",
): CalendarEventData[] {
	const base = events.find((event) => event.id === eventId);
	if (!base) return events;

	if (scope === "" || scope === "this" || base.seriesId === "")
		return events.map((event) =>
			event.id === eventId
				? { ...applyDraft(event, draft), seriesException: scope === "this" }
				: event,
		);

	return events.map((event) => {
		if (event.seriesId !== base.seriesId) return event;
		if (scope === "following" && event.start < base.start) return event;
		return {
			...applyDraft(event, { ...draft, date: event.start.slice(0, 10) }),
			seriesException: false,
		};
	});
}
