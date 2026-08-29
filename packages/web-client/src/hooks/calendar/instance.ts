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

/** The device's own clock, the only zone a browser can honestly draw in. */
export const deviceTimeZone = (): string =>
	Intl.DateTimeFormat().resolvedOptions().timeZone;

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
 */
export function toCalendarEventData(
	instance: RemitImapCalendarEventInstance,
	timeZone: string,
): CalendarEventData {
	return {
		id: calendarInstanceId(instance.calendarObjectId, instance.recurrenceId),
		calendarId: instance.calendarId,
		title: instance.summary,
		start: instance.start,
		end: instance.end,
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
