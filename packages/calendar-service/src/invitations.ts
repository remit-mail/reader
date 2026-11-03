import type { CalendarInviteAnswer as CalendarInviteAnswerValue } from "@remit/api-openapi-types";
import type { AccountItem } from "@remit/data-ports";
import {
	AccountService,
	CalendarInviteMethod,
	CalendarParticipation,
	RecurrenceScope,
} from "@remit/domain-enums";
import type { CalendarEventFields } from "./build.js";
import { type CalendarResult, calendarFailure } from "./errors.js";
import { type ParsedCalendar, parseCalendar } from "./parse.js";
import {
	attendeesOf,
	calendarAddressOf,
	organizerOf,
	participationOf,
	selfAddressSet,
} from "./participation.js";
import {
	applyAnswer,
	applyGuestList,
	bumpSequence,
	type CalendarPerson,
	distinctGuests,
	guestAddressesOf,
	invalidGuestOf,
	type SchedulingMethod,
} from "./scheduling.js";
import type { RecurrenceScopeValue, ScopedWrite } from "./scope.js";

type Account = Pick<AccountItem, "accountId" | "email" | "syncedServices">;

/** Whether an account can send: a scheduling message goes out as mail. */
export const sendsMail = (
	account: Pick<AccountItem, "syncedServices">,
): boolean => account.syncedServices.includes(AccountService.Mail);

/**
 * The account invitations go out from by default: the one the reader set, while
 * it still sends mail, and otherwise the account an event is on. A calendar
 * belongs to the account config rather than to one account, so a new event is
 * on the config's first account that sends mail.
 */
export const invitationSenderInEffect = <A extends Account>(
	accounts: readonly A[],
	settingAccountId: string | undefined,
): A | undefined =>
	accounts.find(
		(account) => account.accountId === settingAccountId && sendsMail(account),
	) ?? accounts.find(sendsMail);

/** The account a request names to send from, refused when it cannot send. */
export const sendingAccountFor = <A extends Account>(
	accounts: readonly A[],
	accountId: string,
): CalendarResult<A> => {
	const account = accounts.find(
		(candidate) => candidate.accountId === accountId,
	);
	if (!account) {
		return calendarFailure(
			"UnknownOrganizer",
			`no account ${accountId} on this account config to send the invitations from`,
		);
	}
	if (!sendsMail(account)) {
		return calendarFailure(
			"OrganizerCannotSend",
			`${account.email} has Mail turned off, so it cannot send invitations. Turn Mail on for it in Settings, or send from another account.`,
		);
	}
	return { ok: true, value: account };
};

const accountByAddress = <A extends Account>(
	accounts: readonly A[],
	address: string,
): A | undefined =>
	accounts.find((account) => account.email.toLowerCase() === address);

/** A guest list as the editor sent it, refused when an entry is not an address. */
export const guestListOf = (
	organizer: string,
	attendees: readonly CalendarPerson[],
): CalendarResult<CalendarPerson[]> => {
	const invalid = invalidGuestOf(attendees);
	if (invalid) {
		return calendarFailure(
			"InvalidGuest",
			`"${invalid.email}" is not a mail address, so no invitation can go to it`,
		);
	}
	return { ok: true, value: distinctGuests(organizer, attendees) };
};

const guestPeopleOf = (calendar: ParsedCalendar): CalendarPerson[] =>
	attendeesOf(calendar.master)
		.filter((attendee) => attendee.role === "Guest")
		.map((attendee) => ({
			email: attendee.email,
			displayName: attendee.displayName,
		}));

const personOf = (
	people: readonly CalendarPerson[],
	email: string,
): CalendarPerson =>
	people.find((person) => person.email === email) ?? { email, displayName: "" };

/**
 * Who gets which scheduling message after an organizer saves an event.
 *
 * Every guest still on the list gets the event as it now stands: a save is a
 * revision, and a guest who keeps the old one keeps the old time. A guest the
 * save took off the list gets a cancellation, and only them.
 */
export const planGuestFanOut = (
	previousGuests: readonly string[],
	currentGuests: readonly string[],
): { request: string[]; cancel: string[] } => {
	const current = new Set(currentGuests);
	return {
		request: [...current],
		cancel: [...new Set(previousGuests)].filter((guest) => !current.has(guest)),
	};
};

/**
 * What a delete sends. Removing the whole event cancels it for every guest.
 * Removing one occurrence or the rest of a series leaves an event behind, and
 * the guests get that event — with the EXDATE or the shortened rule — rather
 * than a cancellation of a series that still exists.
 */
export const planDeleteFanOut = (
	removedWhole: boolean,
	guests: readonly string[],
): { method: SchedulingMethod; recipients: string[] } => ({
	method: removedWhole
		? CalendarInviteMethod.Cancel
		: CalendarInviteMethod.Request,
	recipients: [...new Set(guests)],
});

/** One message to queue: about which stored resource, to whom, saying what. */
export interface SchedulingSendPlan {
	method: SchedulingMethod;
	calendarObjectId: string;
	/** The stored resource the message is built from. */
	icalData: string;
	collectionTimezone: string;
	recipient: CalendarPerson;
	/** For a REPLY: the guest answering. For the rest: the recipient. */
	attendee: CalendarPerson;
	recurrenceId: string;
	answer?: CalendarInviteAnswerValue;
}

/** The messages a write queues, and the account they go out from. */
export interface SchedulingSends<A> {
	from: A;
	plans: SchedulingSendPlan[];
}

/** The plain-text body a scheduling message carries beside its calendar part. */
export const schedulingBody = (subject: string, icalData: string): string => {
	const start = /\r?\nDTSTART[^:]*:([^\r\n]+)/.exec(icalData)?.[1] ?? "";
	return start === "" ? `${subject}\n` : `${subject}\nWhen: ${start}\n`;
};

const requests = (
	guests: readonly CalendarPerson[],
	resource: { calendarObjectId: string; icalData: string },
	collectionTimezone: string,
): SchedulingSendPlan[] =>
	guests.map((guest) => ({
		method: CalendarInviteMethod.Request,
		calendarObjectId: resource.calendarObjectId,
		icalData: resource.icalData,
		collectionTimezone,
		recipient: guest,
		attendee: guest,
		recurrenceId: "",
	}));

/** What a create must know before it writes: who sends, and to whom. */
export const planEventCreate = <A extends Account>(
	accounts: readonly A[],
	settingAccountId: string | undefined,
	attendees: readonly CalendarPerson[],
	organizerAccountId: string | undefined,
): CalendarResult<{ organizer: A; guests: CalendarPerson[] } | null> => {
	if (organizerAccountId !== undefined) {
		const named = sendingAccountFor(accounts, organizerAccountId);
		if (!named.ok) return named;
	}
	if (attendees.length === 0) return { ok: true, value: null };
	const organizer =
		organizerAccountId !== undefined
			? sendingAccountFor(accounts, organizerAccountId)
			: (() => {
					const inEffect = invitationSenderInEffect(accounts, settingAccountId);
					return inEffect
						? ({ ok: true, value: inEffect } as const)
						: calendarFailure<A>(
								"OrganizerCannotSend",
								"none of your accounts sends mail, so no invitation can go out",
							);
				})();
	if (!organizer.ok) return organizer;
	const guests = guestListOf(organizer.value.email, attendees);
	if (!guests.ok) return guests;
	return {
		ok: true,
		value: { organizer: organizer.value, guests: guests.value },
	};
};

export const planCreateSends = <A extends Account>(
	planned: { organizer: A; guests: CalendarPerson[] },
	stored: { calendarObjectId: string; icalData: string },
	collectionTimezone: string,
): SchedulingSends<A> => ({
	from: planned.organizer,
	plans: requests(planned.guests, stored, collectionTimezone),
});

/** The scheduling half of an event update. */
export interface EventSchedulingUpdate {
	attendees?: CalendarPerson[];
	organizerAccountId?: string;
	answer?: CalendarInviteAnswerValue;
}

/** What an update decided about scheduling before anything is written. */
export interface PlannedEventUpdate<A> {
	storedOrganizer: string;
	previousGuests: CalendarPerson[];
	guests: CalendarPerson[];
	/** The account the organizer's messages go out from; absent when none are owed. */
	organizer: A | undefined;
	/** The reader's own address on the guest list, when they answer. */
	answeringAs: string;
	/** Whether the organizer's guests are owed the revision. */
	organized: boolean;
}

/**
 * Decides who an update writes as and owes messages to, refused before
 * anything is written: a guest list only its organizer may change, an answer
 * only a guest may give, and nobody to send from refuses the save rather than
 * leaving guests uninvited.
 */
export const planEventUpdate = <A extends Account>(
	calendar: ParsedCalendar,
	accounts: readonly A[],
	settingAccountId: string | undefined,
	scope: RecurrenceScopeValue,
	update: EventSchedulingUpdate,
): CalendarResult<PlannedEventUpdate<A>> => {
	const self = selfAddressSet(accounts.map((account) => account.email));
	const storedOrganizer = organizerOf(calendar.master);
	const previousGuests = guestPeopleOf(calendar);

	let answeringAs = "";
	if (update.answer !== undefined) {
		if (scope === RecurrenceScope.Following) {
			return calendarFailure(
				"InvalidScope",
				"an answer is to one occurrence (This) or to the series (All), never to the rest of it",
			);
		}
		const participation = participationOf(calendar.master, self);
		if (
			participation === CalendarParticipation.Organizer ||
			participation === CalendarParticipation.Unscheduled
		) {
			return calendarFailure(
				"NotAGuest",
				"you are not a guest of this event, so there is no invitation to answer",
			);
		}
		answeringAs =
			calendar.master
				.getAllProperties("attendee")
				.map((line) => calendarAddressOf(line.getFirstValue()))
				.find((address) => self.has(address)) ?? "";
	}

	if (update.organizerAccountId !== undefined) {
		const named = sendingAccountFor(accounts, update.organizerAccountId);
		if (!named.ok) return named;
	}

	let organizer: A | undefined;
	if (storedOrganizer !== "" && self.has(storedOrganizer)) {
		organizer = accountByAddress(accounts, storedOrganizer);
	}
	if (update.attendees !== undefined) {
		if (storedOrganizer !== "" && !organizer) {
			return calendarFailure(
				"NotOrganizer",
				`${storedOrganizer} organizes this event, so only they can change its guests`,
			);
		}
		if (
			organizer &&
			update.organizerAccountId !== undefined &&
			update.organizerAccountId !== organizer.accountId
		) {
			return calendarFailure(
				"NotOrganizer",
				`${storedOrganizer} organizes this event; the organizer of an event never changes`,
			);
		}
		if (!organizer) {
			organizer =
				update.organizerAccountId !== undefined
					? accounts.find(
							(account) => account.accountId === update.organizerAccountId,
						)
					: invitationSenderInEffect(accounts, settingAccountId);
		}
	}
	if (
		organizer &&
		(update.attendees !== undefined || previousGuests.length > 0)
	) {
		const sending = sendingAccountFor(accounts, organizer.accountId);
		if (!sending.ok) return sending;
	}
	if (update.attendees !== undefined && !organizer) {
		return calendarFailure(
			"OrganizerCannotSend",
			"none of your accounts sends mail, so no invitation can go out",
		);
	}

	let guests = previousGuests;
	if (update.attendees !== undefined && organizer) {
		const listed = guestListOf(organizer.email, update.attendees);
		if (!listed.ok) return listed;
		guests = listed.value;
	}

	return {
		ok: true,
		value: {
			storedOrganizer,
			previousGuests,
			guests,
			organizer,
			answeringAs,
			organized:
				organizer !== undefined && guests.length + previousGuests.length > 0,
		},
	};
};

const touchesSchedule = (patch: Partial<CalendarEventFields>): boolean =>
	patch.start !== undefined ||
	patch.end !== undefined ||
	patch.allDay !== undefined ||
	patch.timeZone !== undefined ||
	patch.recurrenceRule !== undefined;

/**
 * The bytes an update stores: the guest list on the resource the patch applied
 * to, SEQUENCE moved past the last revision when the organizer reschedules, and
 * the reader's own answer on the occurrence or the series they answered.
 */
export const shapeScheduledUpdate = async <A extends Account>(
	write: Exclude<ScopedWrite, { kind: "Delete" }>,
	planned: PlannedEventUpdate<A>,
	update: EventSchedulingUpdate,
	patch: Partial<CalendarEventFields>,
	collectionTimezone: string,
	scope: RecurrenceScopeValue,
	recurrenceId: string,
): Promise<CalendarResult<ScopedWrite>> => {
	const reschedules = planned.organized && touchesSchedule(patch);
	const finish = async (
		icalData: string,
		patched: boolean,
	): Promise<string> => {
		let next = icalData;
		if (patched && planned.organizer && update.attendees !== undefined) {
			next = await applyGuestList(
				next,
				{ email: planned.organizer.email, displayName: "" },
				planned.guests,
			);
		}
		if (reschedules) next = await bumpSequence(next);
		return next;
	};
	if (write.kind === "Split") {
		return {
			ok: true,
			value: {
				kind: "Split",
				icalData: await finish(write.icalData, false),
				following: await finish(write.following, true),
			},
		};
	}
	const replaced = await finish(write.icalData, true);
	if (update.answer === undefined) {
		return { ok: true, value: { kind: "Replace", icalData: replaced } };
	}
	const answered = await applyAnswer(
		replaced,
		collectionTimezone,
		planned.answeringAs,
		update.answer,
		scope === RecurrenceScope.This ? recurrenceId : "",
	);
	if (!answered.ok) return answered;
	return { ok: true, value: { kind: "Replace", icalData: answered.value } };
};

const guestsOfStored = async (icalData: string): Promise<string[]> => {
	const parsed = await parseCalendar(icalData);
	if (!parsed.ok) {
		throw new Error(
			`a calendar resource this server wrote no longer parses: ${parsed.error.message}`,
		);
	}
	return guestAddressesOf(parsed.value);
};

interface StoredResource {
	calendarObjectId: string;
	icalData: string;
}

/**
 * The messages an update owes: the revision to every guest of each resource
 * it wrote, a cancellation to each guest it removed, and the reader's reply to
 * the organizer when they answered as a guest.
 */
export const planUpdateSends = async <A extends Account>(
	planned: PlannedEventUpdate<A>,
	accounts: readonly A[],
	update: EventSchedulingUpdate,
	original: StoredResource,
	written: readonly StoredResource[],
	collectionTimezone: string,
	scope: RecurrenceScopeValue,
	recurrenceId: string,
): Promise<SchedulingSends<A> | null> => {
	if (planned.organized && planned.organizer) {
		const fanOut = planGuestFanOut(
			planned.previousGuests.map((guest) => guest.email),
			planned.guests.map((guest) => guest.email),
		);
		const plans: SchedulingSendPlan[] = [];
		for (const resource of written) {
			const current = await guestsOfStored(resource.icalData);
			plans.push(
				...requests(
					fanOut.request
						.filter((email) => current.includes(email))
						.map((email) => personOf(planned.guests, email)),
					resource,
					collectionTimezone,
				),
			);
		}
		for (const email of fanOut.cancel) {
			const person = personOf(planned.previousGuests, email);
			plans.push({
				method: CalendarInviteMethod.Cancel,
				calendarObjectId: original.calendarObjectId,
				icalData: original.icalData,
				collectionTimezone,
				recipient: person,
				attendee: person,
				recurrenceId: "",
			});
		}
		return { from: planned.organizer, plans };
	}
	const result = written.at(-1);
	if (
		update.answer === undefined ||
		!result ||
		planned.storedOrganizer === ""
	) {
		return null;
	}
	const from = accountByAddress(accounts, planned.answeringAs);
	if (!from) return null;
	return {
		from,
		plans: [
			{
				method: CalendarInviteMethod.Reply,
				calendarObjectId: result.calendarObjectId,
				icalData: result.icalData,
				collectionTimezone,
				recipient: { email: planned.storedOrganizer, displayName: "" },
				attendee: { email: planned.answeringAs, displayName: "" },
				recurrenceId: scope === RecurrenceScope.This ? recurrenceId : "",
				answer: update.answer,
			},
		],
	};
};

/** The messages a delete owes, only on an event the reader organizes. */
export const planDeleteSends = <A extends Account>(
	calendar: ParsedCalendar,
	accounts: readonly A[],
	original: StoredResource,
	remaining: StoredResource | null,
	collectionTimezone: string,
): SchedulingSends<A> | null => {
	const self = selfAddressSet(accounts.map((account) => account.email));
	const storedOrganizer = organizerOf(calendar.master);
	const guests = guestPeopleOf(calendar);
	const organizer = self.has(storedOrganizer)
		? accountByAddress(accounts, storedOrganizer)
		: undefined;
	if (!organizer || guests.length === 0) return null;
	const fanOut = planDeleteFanOut(
		remaining === null,
		guests.map((guest) => guest.email),
	);
	const source = remaining ?? original;
	return {
		from: organizer,
		plans: fanOut.recipients.map((email) => {
			const person = personOf(guests, email);
			return {
				method: fanOut.method,
				calendarObjectId: original.calendarObjectId,
				icalData: source.icalData,
				collectionTimezone,
				recipient: person,
				attendee: person,
				recurrenceId: "",
			};
		}),
	};
};
