import type { ICalendarStore } from "@remit/data-ports";
import { CalendarInviteMethod, RecurrenceScope } from "@remit/domain-enums";
import ICAL from "ical.js";
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
	selfAddressSet,
} from "./participation.js";
import { prepareCalendarObject } from "./put.js";
import { applyScopedUpdate } from "./scope.js";
import { inviteMethodOf } from "./suggest.js";
import { resolveTime, tzidOf } from "./time.js";

/** A reply's place in the order replies are applied in. */
export interface ReplyRevision {
	sequence: number;
	/** The reply's DTSTAMP, UTC basic form (`20261103T120000Z`), or `""`. */
	stamp: string;
}

/**
 * Whether a reply overtakes the answer the organizer's copy already holds
 * (RFC 5546 2.1.5): a reply to an older revision of the event is stale, and of
 * two replies to the same revision the later DTSTAMP wins.
 */
export const replyOvertakes = (
	stored: ReplyRevision,
	reply: ReplyRevision,
): boolean => {
	if (reply.sequence < stored.sequence) return false;
	if (stored.stamp === "") return true;
	return reply.stamp > stored.stamp;
};

export type RecordCalendarReplyOutcome =
	| "Recorded"
	| "NotAReply"
	| "Unreadable"
	| "NotOrganized"
	| "Stale";

export interface RecordCalendarReplyInput {
	accountConfigId: string;
	/** The `text/calendar` part as it arrived. */
	icalData: string;
	/** The addresses of the account config's accounts. */
	selfAddresses: readonly string[];
}

const sequenceOf = (component: ICAL.Component): number => {
	const value = component.getFirstPropertyValue("sequence");
	return typeof value === "number" ? value : 0;
};

const stampOf = (component: ICAL.Component): string => {
	const value = component.getFirstPropertyValue("dtstamp");
	return value instanceof ICAL.Time
		? value.convertToZone(ICAL.Timezone.utcTimezone).toICALString()
		: "";
};

const recurrenceSlotOf = (
	component: ICAL.Component,
	collectionTimezone: string,
): string => {
	const value = component.getFirstPropertyValue("recurrence-id");
	if (!(value instanceof ICAL.Time)) return "";
	return resolveTime(
		value,
		tzidOf(component.getFirstProperty("recurrence-id")),
		collectionTimezone,
	).isoUtc;
};

/**
 * The organizer's VEVENTs one reply VEVENT answers: the override for its
 * RECURRENCE-ID, made when the series has none yet, or every VEVENT when the
 * reply answers the series.
 */
const targetsOf = async (
	stored: ParsedCalendar,
	collectionTimezone: string,
	slot: string,
): Promise<{ calendar: ParsedCalendar; targets: ICAL.Component[] }> => {
	if (slot === "") {
		return { calendar: stored, targets: [stored.master, ...stored.overrides] };
	}
	const existing = overridesBySlot(stored, collectionTimezone).get(slot);
	if (existing) return { calendar: stored, targets: [existing] };
	const written = await applyScopedUpdate(
		stored,
		collectionTimezone,
		{ scope: RecurrenceScope.This, recurrenceId: slot, followingUid: "" },
		{},
	);
	if (!written.ok || written.value.kind !== "Replace") {
		return { calendar: stored, targets: [] };
	}
	const reparsed = await parseCalendar(written.value.icalData);
	if (!reparsed.ok) return { calendar: stored, targets: [] };
	const override = overridesBySlot(reparsed.value, collectionTimezone).get(
		slot,
	);
	return { calendar: reparsed.value, targets: override ? [override] : [] };
};

/**
 * Applies a guest's `METHOD:REPLY` to the event the reader organizes.
 *
 * The write is local: the organizer's copy is the calendar row, and it goes
 * through the single write path so the guest's answer reaches the occurrence
 * index too. Nothing is sent back. A reply the reader does not organize, or
 * one older than the answer already held, changes nothing.
 */
export const recordCalendarReply = async (
	store: ICalendarStore,
	input: RecordCalendarReplyInput,
): Promise<RecordCalendarReplyOutcome> => {
	const reply = await parseCalendar(input.icalData);
	if (!reply.ok) return "Unreadable";
	if (inviteMethodOf(reply.value.component) !== CalendarInviteMethod.Reply) {
		return "NotAReply";
	}

	const self = selfAddressSet(input.selfAddresses);
	const collections = await store.repos.calendarCollection.listByAccountConfig(
		input.accountConfigId,
	);
	for (const collection of collections) {
		const object = await store.repos.calendarObject.findByUid(
			collection.calendarId,
			reply.value.uid,
		);
		if (!object) continue;
		const stored = await parseCalendar(object.icalData);
		if (!stored.ok) return "Unreadable";
		if (!self.has(organizerOf(stored.value.master))) return "NotOrganized";

		let calendar = stored.value;
		let changed = false;
		for (const answered of [reply.value.master, ...reply.value.overrides]) {
			const revision = {
				sequence: sequenceOf(answered),
				stamp: stampOf(answered),
			};
			const found = await targetsOf(
				calendar,
				collection.timezone,
				recurrenceSlotOf(answered, collection.timezone),
			);
			calendar = found.calendar;
			for (const line of answered.getAllProperties("attendee")) {
				const guest = calendarAddressOf(line.getFirstValue());
				const partstat = line.getParameter("partstat");
				if (typeof partstat !== "string") continue;
				for (const target of found.targets) {
					const own = attendeeLineOf(target, guest);
					if (!own) continue;
					const heldStamp = own.getParameter(REPLY_STAMP_PARAMETER);
					const held = {
						sequence: sequenceOf(target),
						stamp: typeof heldStamp === "string" ? heldStamp : "",
					};
					if (!replyOvertakes(held, revision)) continue;
					own.setParameter("partstat", partstat.toUpperCase());
					own.removeParameter("rsvp");
					if (revision.stamp !== "") {
						own.setParameter(REPLY_STAMP_PARAMETER, revision.stamp);
					}
					changed = true;
				}
			}
		}
		if (!changed) return "Stale";

		const write = await prepareCalendarObject(collection, {
			accountConfigId: input.accountConfigId,
			calendarId: collection.calendarId,
			resourceName: object.resourceName,
			icalData: serializeCalendar(calendar.component),
			selfAddresses: input.selfAddresses,
		});
		if (!write.ok) return "Unreadable";
		await store.commit([write.value]);
		return "Recorded";
	}
	return "NotOrganized";
};
