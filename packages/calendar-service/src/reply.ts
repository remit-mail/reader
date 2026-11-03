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
	selfAddressSet,
} from "./participation.js";

/**
 * Where the organizer's copy keeps the DTSTAMP of the reply it last applied for
 * a guest, so a reply that arrives late cannot undo a newer one.
 */
const APPLIED_REPLY_STAMP = "x-remit-reply-stamp";

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
	if (!written.ok) {
		throw new Error(
			`a reply to ${slot} could not be given an override of its own: ${written.error.message}`,
		);
	}
	if (written.value.kind !== "Replace") {
		throw new Error(
			`a reply to ${slot} resolved to a ${written.value.kind} rather than an override`,
		);
	}
	const reparsed = await parseCalendar(written.value.icalData);
	if (!reparsed.ok) {
		throw new Error(
			`an override this server wrote no longer parses: ${reparsed.error.message}`,
		);
	}
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
		if (!stored.ok) {
			throw new Error(
				`stored calendar object ${object.calendarObjectId} no longer parses: ${stored.error.message}`,
			);
		}
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
					const heldStamp = own.getParameter(APPLIED_REPLY_STAMP);
					const held = {
						sequence: sequenceOf(target),
						stamp: typeof heldStamp === "string" ? heldStamp : "",
					};
					if (!replyOvertakes(held, revision)) continue;
					own.setParameter("partstat", partstat.toUpperCase());
					own.removeParameter("rsvp");
					if (revision.stamp !== "") {
						own.setParameter(APPLIED_REPLY_STAMP, revision.stamp);
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
		});
		if (!write.ok) {
			throw new Error(
				`a reply applied to ${object.calendarObjectId} was refused by the write path: ${write.error.message}`,
			);
		}
		// Conditional on the version the reply was applied to. An edit that
		// landed meanwhile is a conflict: the write is refused loudly, the
		// body-sync job fails, and the queue's redelivery applies the reply to
		// the event as it now stands.
		const report = await store.commit([
			{ ...write.value, kind: "ReprojectObject", readEtag: object.etag },
		]);
		if (report.staleReprojections.length > 0) {
			throw new Error(
				`${object.calendarObjectId} changed while a guest's reply was applied to it`,
			);
		}
		return "Recorded";
	}
	return "NotOrganized";
};
