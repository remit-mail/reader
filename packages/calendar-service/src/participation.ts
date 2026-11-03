import type {
	CalendarAttendee,
	CalendarAttendeeCounts,
	CalendarInviteAnswer as CalendarInviteAnswerValue,
	CalendarParticipation as CalendarParticipationValue,
} from "@remit/api-openapi-types";
import {
	CalendarAttendeeRole,
	CalendarAttendeeStatus,
	CalendarParticipation,
} from "@remit/domain-enums";
import type ICAL from "ical.js";
import { overridesBySlot } from "./expand.js";
import type { ParsedCalendar } from "./parse.js";
import { mailAddressOf } from "./suggest.js";

/** The PARTSTAT each answer a guest gives is written as. */
export const PARTSTAT_OF_ANSWER: Record<CalendarInviteAnswerValue, string> = {
	Accepted: "ACCEPTED",
	Tentative: "TENTATIVE",
	Declined: "DECLINED",
};

/** A CAL-ADDRESS as the lower-cased mail address it names. */
export const calendarAddressOf = (value: unknown): string =>
	mailAddressOf(String(value ?? ""))
		.trim()
		.toLowerCase();

/** The addresses that are the reader, lower-cased once for every comparison. */
export const selfAddressSet = (addresses: readonly string[]): Set<string> =>
	new Set(addresses.map((address) => address.trim().toLowerCase()));

const STATUS_BY_PARTSTAT: Record<
	string,
	(typeof CalendarAttendeeStatus)[keyof typeof CalendarAttendeeStatus]
> = {
	ACCEPTED: CalendarAttendeeStatus.Accepted,
	TENTATIVE: CalendarAttendeeStatus.Tentative,
	DECLINED: CalendarAttendeeStatus.Declined,
};

const PARTICIPATION_BY_STATUS: Record<
	(typeof CalendarAttendeeStatus)[keyof typeof CalendarAttendeeStatus],
	CalendarParticipationValue
> = {
	[CalendarAttendeeStatus.NeedsAction]: CalendarParticipation.NeedsAction,
	[CalendarAttendeeStatus.Accepted]: CalendarParticipation.Accepted,
	[CalendarAttendeeStatus.Tentative]: CalendarParticipation.Tentative,
	[CalendarAttendeeStatus.Declined]: CalendarParticipation.Declined,
};

/** A PARTSTAT as an answer. Anything that is not a yes, no or maybe is still owed one. */
export const attendeeStatusOf = (
	property: ICAL.Property,
): CalendarAttendee["status"] =>
	STATUS_BY_PARTSTAT[
		String(property.getParameter("partstat") ?? "").toUpperCase()
	] ?? CalendarAttendeeStatus.NeedsAction;

export const organizerOf = (component: ICAL.Component): string =>
	calendarAddressOf(component.getFirstPropertyValue("organizer"));

/** The ATTENDEE line naming an address, if the component carries one. */
export const attendeeLineOf = (
	component: ICAL.Component,
	address: string,
): ICAL.Property | undefined =>
	component
		.getAllProperties("attendee")
		.find(
			(property) => calendarAddressOf(property.getFirstValue()) === address,
		);

/**
 * Where the reader stands on one VEVENT.
 *
 * An event with no ATTENDEE line has nobody to schedule, whoever it names as
 * ORGANIZER. One the reader organizes is theirs. Otherwise the reader's own
 * ATTENDEE line carries their answer, and an event that lists other people
 * but not the reader has nothing for the reader to answer.
 */
export const participationOf = (
	component: ICAL.Component,
	self: ReadonlySet<string>,
): CalendarParticipationValue => {
	const attendees = component.getAllProperties("attendee");
	if (attendees.length === 0) return CalendarParticipation.Unscheduled;
	if (self.has(organizerOf(component))) return CalendarParticipation.Organizer;
	const own = attendees.find((property) =>
		self.has(calendarAddressOf(property.getFirstValue())),
	);
	if (!own) return CalendarParticipation.Unscheduled;
	return PARTICIPATION_BY_STATUS[attendeeStatusOf(own)];
};

/**
 * Where the reader stands on one occurrence of a stored resource: on the
 * override for its slot when the series has one, which carries its own
 * PARTSTAT, and on the master otherwise. Read from the bytes on every read, so
 * nothing stored can disagree with them.
 */
export const participationAtSlot = (
	calendar: ParsedCalendar,
	collectionTimezone: string,
	recurrenceId: string,
	self: ReadonlySet<string>,
): CalendarParticipationValue => {
	const override =
		recurrenceId === ""
			? undefined
			: overridesBySlot(calendar, collectionTimezone).get(recurrenceId);
	return participationOf(override ?? calendar.master, self);
};

const textParameter = (property: ICAL.Property, name: string): string => {
	const value = property.getParameter(name);
	return typeof value === "string" ? value : "";
};

/**
 * The guest list of one VEVENT, organizer first. The organizer counts as a
 * yes and appears once, even when an ATTENDEE line names them too.
 */
export const attendeesOf = (component: ICAL.Component): CalendarAttendee[] => {
	const lines = component.getAllProperties("attendee");
	if (lines.length === 0) return [];
	const organizerProperty = component.getFirstProperty("organizer");
	const organizer = organizerOf(component);
	const guests = lines
		.map(
			(property): CalendarAttendee => ({
				email: calendarAddressOf(property.getFirstValue()),
				displayName: textParameter(property, "cn"),
				role: CalendarAttendeeRole.Guest,
				status: attendeeStatusOf(property),
			}),
		)
		.filter((guest) => guest.email !== "" && guest.email !== organizer);
	if (organizer === "" || !organizerProperty) return guests;
	return [
		{
			email: organizer,
			displayName: textParameter(organizerProperty, "cn"),
			role: CalendarAttendeeRole.Organizer,
			status: CalendarAttendeeStatus.Accepted,
		},
		...guests,
	];
};

export const countAttendees = (
	attendees: readonly CalendarAttendee[],
): CalendarAttendeeCounts => ({
	accepted: attendees.filter(
		(attendee) => attendee.status === CalendarAttendeeStatus.Accepted,
	).length,
	declined: attendees.filter(
		(attendee) => attendee.status === CalendarAttendeeStatus.Declined,
	).length,
	tentative: attendees.filter(
		(attendee) => attendee.status === CalendarAttendeeStatus.Tentative,
	).length,
	needsAction: attendees.filter(
		(attendee) => attendee.status === CalendarAttendeeStatus.NeedsAction,
	).length,
});
