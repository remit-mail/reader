import type {
	CalendarObjectItem,
	CalendarSuggestionItem,
	ICalendarUnitOfWork,
} from "@remit/data-ports";
import {
	CalendarInviteMethod,
	CalendarSuggestionState,
} from "@remit/domain-enums";
import ICAL from "ical.js";
import type { CalendarResult } from "./errors.js";
import { parseCalendar, serializeCalendar } from "./parse.js";
import { putCalendarObject } from "./put.js";
import { mailAddressOf } from "./suggest.js";

const eventsOf = (component: ICAL.Component): ICAL.Component[] =>
	component.getAllSubcomponents("vevent");

/**
 * Marks one address as having accepted, on every VEVENT of the resource — the
 * master and each override alike, since an attendee's answer is to the series.
 *
 * An ATTENDEE line already naming the user has its PARTSTAT rewritten rather
 * than a second one appended: two ATTENDEE lines for one person is a resource
 * every other client reads as two people.
 */
const markAccepted = (component: ICAL.Component, attendee: string): void => {
	const wanted = attendee.toLowerCase();
	for (const event of eventsOf(component)) {
		const existing = event
			.getAllProperties("attendee")
			.find(
				(property) =>
					mailAddressOf(String(property.getFirstValue())).toLowerCase() ===
					wanted,
			);
		const property =
			existing ?? new ICAL.Property("attendee", event as ICAL.Component);
		property.setParameter("partstat", "ACCEPTED");
		if (!existing) {
			property.setValue(`mailto:${attendee}`);
			event.addProperty(property);
		}
	}
};

const markCancelled = (component: ICAL.Component): void => {
	for (const event of eventsOf(component)) {
		event.removeAllProperties("status");
		event.addPropertyWithValue("status", "CANCELLED");
	}
};

/**
 * The VCALENDAR a stored resource is made of, built from the invitation's own
 * bytes.
 *
 * Built by editing what arrived rather than by composing a fresh event: the
 * UID, the SEQUENCE, the recurrence rule, the overrides and every X- property
 * the organizer's client wrote survive into the calendar, which is what makes
 * the stored resource answer to the same event a later revision or a
 * cancellation names.
 *
 * The METHOD goes. A scheduling message carries one (RFC 5546); a stored
 * calendar object resource must not (RFC 4791 4.1), and leaving it in makes
 * every CalDAV client treat the user's own calendar entry as an unanswered
 * invitation.
 */
export const buildAcceptedCalendar = async (
	suggestion: Pick<CalendarSuggestionItem, "icalData" | "method">,
	attendee: string,
): Promise<CalendarResult<string>> => {
	const parsed = await parseCalendar(suggestion.icalData);
	if (!parsed.ok) return parsed;

	const { component } = parsed.value;
	component.removeAllProperties("method");
	markAccepted(component, attendee);
	if (suggestion.method === CalendarInviteMethod.Cancel) {
		markCancelled(component);
	}

	return { ok: true, value: serializeCalendar(component) };
};

export interface AcceptCalendarSuggestionInput {
	accountConfigId: string;
	calendarId: string;
	suggestion: CalendarSuggestionItem;
	/** Mail address of the person accepting — the account the message arrived on. */
	attendee: string;
}

/**
 * What accepting did.
 *
 * `Written` is the ordinary case: a resource is in the calendar and `object`
 * names it. `NothingToCancel` is a cancellation for a meeting this calendar
 * never held — the user never accepted the invitation, or accepted it
 * somewhere else — where the only honest act is to clear the card. Writing a
 * resource there would put an event in the calendar that exists solely to say
 * it was cancelled, which is worse than the meeting the user never had.
 */
export type AcceptOutcome = "Written" | "NothingToCancel";

export interface AcceptedCalendarSuggestion {
	suggestion: CalendarSuggestionItem;
	outcome: AcceptOutcome;
	/** The resource that was written, `null` for `NothingToCancel`. */
	object: CalendarObjectItem | null;
}

/**
 * Adds a suggested event to a calendar, as one unit.
 *
 * The resource is written through `putCalendarObject`, the same function every
 * other calendar write goes through, so an event added from a mail and one
 * added from the week grid are the same kind of row — and a native client
 * editing it afterwards edits the same bytes. The suggestion's own state is
 * settled inside that transaction: a suggestion marked `Accepted` with no
 * resource behind it, or a resource with the card still asking, is a state
 * nothing later can repair.
 *
 * Accepting a `Cancel` suggestion writes `STATUS:CANCELLED` through that same
 * path, but only onto a resource that is already there. Nothing withdraws an
 * event on its own — a cancellation reaches the calendar only because a person
 * pressed the button, and only when the calendar holds the meeting being
 * withdrawn.
 *
 * No mail is sent. There is no iMIP reply here and none anywhere on this path;
 * the organizer learns nothing from the user accepting.
 *
 * Idempotent. The resource is addressed by the event's UID within the
 * collection, so accepting the same suggestion twice — or accepting a later
 * revision of an event already added — rewrites the one resource rather than
 * leaving the calendar showing the meeting twice.
 */
export const acceptCalendarSuggestion = async (
	unitOfWork: ICalendarUnitOfWork,
	input: AcceptCalendarSuggestionInput,
): Promise<CalendarResult<AcceptedCalendarSuggestion>> => {
	const icalData = await buildAcceptedCalendar(
		input.suggestion,
		input.attendee,
	);
	if (!icalData.ok) return icalData;

	return unitOfWork.transaction(async (repos) => {
		const existing = await repos.calendarObject.findByUid(
			input.calendarId,
			input.suggestion.icalUid,
		);

		// A cancellation cancels something. With no resource carrying this UID
		// there is nothing in the calendar to withdraw, and writing one would
		// invent a meeting the user never had purely to mark it cancelled. Clear
		// the card and leave the calendar untouched.
		if (
			input.suggestion.method === CalendarInviteMethod.Cancel &&
			existing === null
		) {
			const cleared = await repos.calendarSuggestion.settle(
				input.accountConfigId,
				input.suggestion.suggestionId,
				{
					state: CalendarSuggestionState.Dismissed,
					acceptedCalendarObjectId: "",
				},
			);
			return {
				ok: true,
				value: {
					suggestion: cleared,
					outcome: "NothingToCancel",
					object: null,
				},
			};
		}

		const written = await putCalendarObject(unitOfWork, {
			accountConfigId: input.accountConfigId,
			calendarId: input.calendarId,
			resourceName:
				existing?.resourceName ?? `${input.suggestion.suggestionId}.ics`,
			icalData: icalData.value,
		});
		if (!written.ok) return written;

		const settled = await repos.calendarSuggestion.settle(
			input.accountConfigId,
			input.suggestion.suggestionId,
			{
				state: CalendarSuggestionState.Accepted,
				acceptedCalendarObjectId: written.value.calendarObjectId,
			},
		);

		return {
			ok: true,
			value: {
				suggestion: settled,
				outcome: "Written",
				object: written.value,
			},
		};
	});
};
