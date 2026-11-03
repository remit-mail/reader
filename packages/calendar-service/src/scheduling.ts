import type { CalendarInviteAnswer as CalendarInviteAnswerValue } from "@remit/api-openapi-types";
import {
	CalendarInviteAnswer,
	CalendarInviteMethod,
} from "@remit/domain-enums";
import ICAL from "ical.js";
import { type CalendarResult, calendarFailure } from "./errors.js";
import { overridesBySlot } from "./expand.js";
import {
	type ParsedCalendar,
	parseCalendar,
	serializeCalendar,
} from "./parse.js";
import {
	attendeeLineOf,
	calendarAddressOf,
	organizerOf,
	REPLY_STAMP_PARAMETER,
} from "./participation.js";
import { readString } from "./project.js";

/** A person as the scheduling lines name them. */
export interface CalendarPerson {
	email: string;
	displayName: string;
}

/** The iTIP methods this server sends. */
export type SchedulingMethod =
	| typeof CalendarInviteMethod.Request
	| typeof CalendarInviteMethod.Cancel
	| typeof CalendarInviteMethod.Reply;

const ICAL_METHOD: Record<SchedulingMethod, string> = {
	[CalendarInviteMethod.Request]: "REQUEST",
	[CalendarInviteMethod.Cancel]: "CANCEL",
	[CalendarInviteMethod.Reply]: "REPLY",
};

const PARTSTAT_OF: Record<CalendarInviteAnswerValue, string> = {
	[CalendarInviteAnswer.Accepted]: "ACCEPTED",
	[CalendarInviteAnswer.Tentative]: "TENTATIVE",
	[CalendarInviteAnswer.Declined]: "DECLINED",
};

const eventsOf = (calendar: ParsedCalendar): ICAL.Component[] => [
	calendar.master,
	...calendar.overrides,
];

const normalized = (email: string): string => email.trim().toLowerCase();

const personProperty = (
	name: "organizer" | "attendee",
	person: CalendarPerson,
): ICAL.Property => {
	const property = new ICAL.Property(name);
	property.setValue(`mailto:${normalized(person.email)}`);
	if (person.displayName !== "")
		property.setParameter("cn", person.displayName);
	return property;
};

const parsedOrThrow = async (icalData: string): Promise<ParsedCalendar> => {
	const parsed = await parseCalendar(icalData);
	if (!parsed.ok) {
		throw new Error(
			`a calendar resource this server wrote no longer parses: ${parsed.error.message}`,
		);
	}
	return parsed.value;
};

/** The guest addresses of a resource's master, organizer excluded. */
export const guestAddressesOf = (calendar: ParsedCalendar): string[] => {
	const organizer = organizerOf(calendar.master);
	return calendar.master
		.getAllProperties("attendee")
		.map((property) => calendarAddressOf(property.getFirstValue()))
		.filter((email) => email !== "" && email !== organizer);
};

export const guestAddressesOfData = async (
	icalData: string,
): Promise<string[]> => guestAddressesOf(await parsedOrThrow(icalData));

/**
 * Two addresses for one guest is one guest. A guest list that names the
 * organizer drops them: the organizer is on the event as its ORGANIZER.
 */
export const distinctGuests = (
	organizer: string,
	guests: readonly CalendarPerson[],
): CalendarPerson[] => {
	const seen = new Set<string>([normalized(organizer)]);
	const distinct: CalendarPerson[] = [];
	for (const guest of guests) {
		const email = normalized(guest.email);
		if (email === "" || seen.has(email)) continue;
		seen.add(email);
		distinct.push({ email, displayName: guest.displayName });
	}
	return distinct;
};

const EMAIL_SHAPE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** The guest an editor sent that is not a mail address, if there is one. */
export const invalidGuestOf = (
	guests: readonly CalendarPerson[],
): CalendarPerson | undefined =>
	guests.find((guest) => !EMAIL_SHAPE.test(guest.email.trim()));

/**
 * Writes the organizer and the guest list onto every VEVENT of a resource.
 *
 * A guest already on the list keeps the answer they gave; a new one is owed
 * one. The organizer is never an ATTENDEE of their own event here: they are
 * the ORGANIZER, and every client reads that as a yes.
 */
export const applyGuestList = async (
	icalData: string,
	organizer: CalendarPerson,
	guests: readonly CalendarPerson[],
): Promise<string> => {
	const calendar = await parsedOrThrow(icalData);
	const listed = distinctGuests(organizer.email, guests);
	for (const event of eventsOf(calendar)) {
		const previous = new Map(
			event
				.getAllProperties("attendee")
				.map((property) => [
					calendarAddressOf(property.getFirstValue()),
					property,
				]),
		);
		event.removeAllProperties("organizer");
		event.removeAllProperties("attendee");
		if (listed.length === 0) continue;
		event.addProperty(personProperty("organizer", organizer));
		for (const guest of listed) {
			const property = personProperty("attendee", guest);
			const kept = previous.get(guest.email);
			const partstat = kept?.getParameter("partstat");
			const stamp = kept?.getParameter(REPLY_STAMP_PARAMETER);
			property.setParameter("role", "REQ-PARTICIPANT");
			property.setParameter(
				"partstat",
				typeof partstat === "string" ? partstat : "NEEDS-ACTION",
			);
			if (typeof stamp === "string") {
				property.setParameter(REPLY_STAMP_PARAMETER, stamp);
			} else {
				property.setParameter("rsvp", "TRUE");
			}
			event.addProperty(property);
		}
	}
	return serializeCalendar(calendar.component);
};

/**
 * Moves SEQUENCE past every value the resource carries, on every VEVENT. A
 * recipient keeps the highest revision it has seen, so a reschedule has to
 * outrank the invitation it replaces.
 */
export const bumpSequence = async (icalData: string): Promise<string> => {
	const calendar = await parsedOrThrow(icalData);
	const events = eventsOf(calendar);
	const highest = Math.max(
		...events.map((event) => {
			const value = event.getFirstPropertyValue("sequence");
			return typeof value === "number" ? value : 0;
		}),
	);
	for (const event of events) {
		event.removeAllProperties("sequence");
		event.addPropertyWithValue("sequence", highest + 1);
	}
	return serializeCalendar(calendar.component);
};

/**
 * The VEVENTs an answer is written on: the override for one occurrence, or
 * every VEVENT for the series. The override is the one `applyScopedUpdate`
 * made or found for that slot, so it is already in the resource.
 */
const answeredEvents = (
	calendar: ParsedCalendar,
	collectionTimezone: string,
	recurrenceId: string,
): ICAL.Component[] => {
	if (recurrenceId === "") return eventsOf(calendar);
	const override = overridesBySlot(calendar, collectionTimezone).get(
		recurrenceId,
	);
	return override ? [override] : [];
};

/**
 * Writes the reader's PARTSTAT. `recurrenceId` names the one occurrence
 * answered, or `""` for the series. Answered DTSTAMP is the organizer's
 * ordering key when two replies cross, so the reply is stamped, not the event.
 */
export const applyAnswer = async (
	icalData: string,
	collectionTimezone: string,
	attendee: string,
	answer: CalendarInviteAnswerValue,
	recurrenceId: string,
): Promise<CalendarResult<string>> => {
	const calendar = await parsedOrThrow(icalData);
	const events = answeredEvents(calendar, collectionTimezone, recurrenceId);
	const lines = events.flatMap((event) => {
		const line = attendeeLineOf(event, attendee);
		return line ? [line] : [];
	});
	if (lines.length === 0) {
		return calendarFailure(
			"UnknownOccurrence",
			`${attendee} is not on the guest list of that occurrence`,
		);
	}
	for (const line of lines) {
		line.setParameter("partstat", PARTSTAT_OF[answer]);
		line.removeParameter("rsvp");
	}
	return { ok: true, value: serializeCalendar(calendar.component) };
};

export interface SchedulingMessageInput {
	method: SchedulingMethod;
	/** When the message is built; written as every VEVENT's DTSTAMP. */
	now: Date;
	/**
	 * A REQUEST or CANCEL: the guest it goes to, so a cancellation to a
	 * removed guest still names them. A REPLY: the guest answering, the only
	 * ATTENDEE it carries.
	 */
	attendee: CalendarPerson;
	/** A REPLY to one occurrence names it here; `""` answers the series. */
	recurrenceId: string;
	collectionTimezone: string;
}

export interface SchedulingMessage {
	icalData: string;
	sequence: number;
	summary: string;
}

/**
 * The VCALENDAR one scheduling message carries (RFC 5546), built from the
 * stored resource it is about. The stored resource never carries METHOD
 * (RFC 4791 4.1); the message always does.
 */
export const buildSchedulingMessage = async (
	icalData: string,
	input: SchedulingMessageInput,
): Promise<SchedulingMessage> => {
	const calendar = await parsedOrThrow(icalData);
	const { component } = calendar;
	component.removeAllProperties("method");
	component.addPropertyWithValue("method", ICAL_METHOD[input.method]);
	const stamp = ICAL.Time.fromJSDate(input.now, true);
	const attendee = normalized(input.attendee.email);

	let events = eventsOf(calendar);
	if (
		input.method === CalendarInviteMethod.Reply &&
		input.recurrenceId !== ""
	) {
		events = answeredEvents(
			calendar,
			input.collectionTimezone,
			input.recurrenceId,
		);
		for (const event of eventsOf(calendar)) {
			if (!events.includes(event)) component.removeSubcomponent(event);
		}
	}

	for (const event of events) {
		event.removeAllProperties("dtstamp");
		event.addPropertyWithValue("dtstamp", stamp);
		if (input.method === CalendarInviteMethod.Cancel) {
			event.removeAllProperties("status");
			event.addPropertyWithValue("status", "CANCELLED");
			if (!attendeeLineOf(event, attendee)) {
				event.addProperty(personProperty("attendee", input.attendee));
			}
		}
		if (input.method === CalendarInviteMethod.Reply) {
			for (const line of event.getAllProperties("attendee")) {
				if (calendarAddressOf(line.getFirstValue()) !== attendee) {
					event.removeProperty(line);
				}
			}
		}
	}

	const sequence = calendar.master.getFirstPropertyValue("sequence");
	return {
		icalData: serializeCalendar(component),
		sequence: typeof sequence === "number" ? sequence : 0,
		summary: readString(calendar.master, "summary"),
	};
};

/** The subject line a scheduling message goes out under. */
export const schedulingSubject = (
	method: SchedulingMethod,
	summary: string,
	answer?: CalendarInviteAnswerValue,
): string => {
	const title = summary === "" ? "(no title)" : summary;
	if (method === CalendarInviteMethod.Cancel) return `Cancelled: ${title}`;
	if (method === CalendarInviteMethod.Reply) {
		const word =
			answer === CalendarInviteAnswer.Declined
				? "Declined"
				: answer === CalendarInviteAnswer.Tentative
					? "Tentative"
					: "Accepted";
		return `${word}: ${title}`;
	}
	return `Invitation: ${title}`;
};
