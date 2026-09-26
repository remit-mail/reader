/**
 * The API's shapes, as the calendar kit draws them.
 *
 * One place does the translating, so the grid, the strip and the reading pane
 * cannot disagree about what an occurrence is. Nothing here expands a
 * recurrence: the server returns instances, and this reads them.
 */
import type {
	RemitImapCalendarEventInstance,
	RemitImapCalendarResponse,
} from "@remit/api-http-client/types.gen.ts";
import type {
	CalendarColorId,
	CalendarDescriptor,
	CalendarEventData,
	ZoneCertainty,
} from "@remit/ui";
import { isoOnClock } from "./window";

/** The device's own clock, the only zone a browser can honestly draw in. */
export const deviceTimeZone = (): string =>
	Intl.DateTimeFormat().resolvedOptions().timeZone;

/** A collection that names no zone of its own, spelled the way the API spells it. */
export const UNZONED_CALENDAR = "";

/**
 * The zone a write anchors an event in: the collection's, or where it names
 * none, the device's — a weekly 09:00 written from New York into an unzoned
 * calendar would otherwise be stored in UTC and meet at 10:00 once the clocks
 * change. UTC itself has no name the server takes as a TZID, so a device on it
 * sends nothing, which the server reads as UTC.
 */
export function anchorZoneFor(collectionZone: string): string {
	if (collectionZone !== UNZONED_CALENDAR) return collectionZone;
	const device = deviceTimeZone();
	return Intl.supportedValuesOf("timeZone").includes(device)
		? device
		: UNZONED_CALENDAR;
}

const COLORS: Record<string, CalendarColorId> = {
	Cal1: "cal-1",
	Cal2: "cal-2",
	Cal3: "cal-3",
	Cal4: "cal-4",
	Cal5: "cal-5",
	Cal6: "cal-6",
};

const ZONES: Record<string, ZoneCertainty> = {
	Local: "local",
	Explicit: "explicit",
	Ambiguous: "ambiguous",
};

/**
 * The address of one occurrence, as a single string, because the grid selects
 * an event by one id. A series draws many occurrences from one resource, so the
 * resource id alone would key every Monday standup the same and select all of
 * them at once.
 */
const OCCURRENCE_SEPARATOR = "#";

export function calendarInstanceId(
	calendarObjectId: string,
	recurrenceId: string,
): string {
	return recurrenceId === ""
		? calendarObjectId
		: `${calendarObjectId}${OCCURRENCE_SEPARATOR}${recurrenceId}`;
}

export interface CalendarInstanceRef {
	calendarObjectId: string;
	/** `""` on a resource that does not recur. */
	recurrenceId: string;
}

export function readCalendarInstanceId(id: string): CalendarInstanceRef {
	const cut = id.indexOf(OCCURRENCE_SEPARATOR);
	if (cut === -1) return { calendarObjectId: id, recurrenceId: "" };
	return {
		calendarObjectId: id.slice(0, cut),
		recurrenceId: id.slice(cut + 1),
	};
}

const nextOrFirst = (
	events: readonly CalendarEventData[],
	now: string,
): CalendarEventData | undefined => {
	const ordered = [...events].sort(
		(a, b) => Date.parse(a.start) - Date.parse(b.start),
	);
	return (
		ordered.find((event) => Date.parse(event.end) > Date.parse(now)) ??
		ordered[0]
	);
};

/**
 * The occurrence a series opens at when the address names only the series: the
 * next one still to finish, or the first in the window where none is left.
 */
export function seriesOccurrenceOf(
	events: readonly CalendarEventData[],
	calendarObjectId: string,
	now: string,
): CalendarInstanceRef | undefined {
	const picked = nextOrFirst(
		events.filter((event) => {
			const ref = readCalendarInstanceId(event.id);
			return (
				ref.calendarObjectId === calendarObjectId && ref.recurrenceId !== ""
			);
		}),
		now,
	);
	return picked ? readCalendarInstanceId(picked.id) : undefined;
}

export interface CalendarJump extends CalendarInstanceRef {
	calendarId: string;
	/** On the clock the calendar is drawn in. */
	date: string;
}

/**
 * Where a view has to move to show an event it does not hold: the day of its
 * next occurrence still to finish, or of its first where none is left.
 */
export function calendarJumpOf(
	instances: readonly RemitImapCalendarEventInstance[],
	calendarObjectId: string,
	now: string,
	clockZone: string,
): CalendarJump | undefined {
	const picked = nextOrFirst(
		instances
			.filter(
				(instance) =>
					instance.calendarObjectId === calendarObjectId &&
					isDrawnInstance(instance),
			)
			.map((instance) => toCalendarEventData(instance, "", clockZone)),
		now,
	);
	if (!picked) return undefined;
	return {
		...readCalendarInstanceId(picked.id),
		calendarId: picked.calendarId,
		date: picked.start.slice(0, 10),
	};
}

export function toCalendarDescriptor(
	calendar: RemitImapCalendarResponse,
): CalendarDescriptor {
	return {
		id: calendar.calendarId,
		accountId: calendar.accountConfigId,
		accountLabel: "",
		name: calendar.displayName,
		color: COLORS[calendar.color] ?? "cal-1",
	};
}

/**
 * One occurrence, drawn. `location`, `notes` and the guest list are projections
 * the listing does not carry — the reading pane fetches the resource itself for
 * those, and a grid chip has no room for them anyway.
 *
 * A timed occurrence is re-read on `clockZone`, the clock every surface draws
 * on. An all-day one is a civil date and keeps only its date: midnight with an
 * offset is an instant, and a device west of it reads that instant as the day
 * before.
 */
export function toCalendarEventData(
	instance: RemitImapCalendarEventInstance,
	timeZone: string,
	clockZone: string,
): CalendarEventData {
	return {
		id: calendarInstanceId(instance.calendarObjectId, instance.recurrenceId),
		calendarId: instance.calendarId,
		title: instance.summary,
		start: instance.allDay
			? instance.start.slice(0, 10)
			: isoOnClock(instance.start, clockZone),
		end: instance.allDay
			? instance.end.slice(0, 10)
			: isoOnClock(instance.end, clockZone),
		allDay: instance.allDay,
		location: "",
		notes: "",
		attendees: [],
		myRsvp: "accepted",
		threadId: "",
		threadSubject: "",
		timeZone,
		zoneCertainty: ZONES[instance.zoneCertainty] ?? "explicit",
		recurrenceRule: instance.hasRecurrence ? "Repeats" : "",
		seriesId: instance.hasRecurrence ? instance.icalUid : "",
		seriesException: false,
		status: instance.status === "Tentative" ? "tentative" : "confirmed",
	};
}

/**
 * A cancelled occurrence is not a lighter shade of confirmed, and the kit has
 * no third state to draw it in, so it is left off the calendar entirely rather
 * than shown as an event that is still happening.
 */
export const isDrawnInstance = (
	instance: RemitImapCalendarEventInstance,
): boolean => instance.status !== "Cancelled";
