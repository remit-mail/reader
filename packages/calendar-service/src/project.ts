import type { CalendarObjectItem } from "@remit/data-ports";
import { CalendarEventStatus, CalendarTransparency } from "@remit/domain-enums";
import ICAL from "ical.js";
import { type CalendarResult, calendarFailure } from "./errors.js";
import type { ParsedCalendar } from "./parse.js";
import { resolveTime, tzidOf } from "./time.js";

/**
 * The columns `CalendarObject` carries beside its bytes. Every one of them is
 * read out of the VEVENT here and nowhere else, so the row can only ever
 * describe the `icalData` it was written with.
 */
export type CalendarObjectProjection = Pick<
	CalendarObjectItem,
	| "icalUid"
	| "summary"
	| "dtStart"
	| "dtEnd"
	| "allDay"
	| "zoneCertainty"
	| "status"
	| "transparency"
	| "hasRecurrence"
	| "sequence"
>;

const STATUS_BY_ICAL: Record<string, CalendarObjectItem["status"]> = {
	CONFIRMED: CalendarEventStatus.Confirmed,
	TENTATIVE: CalendarEventStatus.Tentative,
	CANCELLED: CalendarEventStatus.Cancelled,
};

const TRANSPARENCY_BY_ICAL: Record<string, CalendarObjectItem["transparency"]> =
	{
		OPAQUE: CalendarTransparency.Opaque,
		TRANSPARENT: CalendarTransparency.Transparent,
	};

const readString = (component: ICAL.Component, name: string): string => {
	const value = component.getFirstPropertyValue(name);
	return typeof value === "string" ? value : "";
};

/**
 * Whether the resource expands to more than its master instance — an RRULE, an
 * RDATE, or an override VEVENT. The overrides count: a client that edits one
 * instance of a series and then deletes the rule leaves a resource with nothing
 * but a master and its exceptions, and every one of those is still an
 * occurrence somebody has to see.
 */
/**
 * The fields that describe one VEVENT rather than the series it belongs to.
 *
 * Read per occurrence as well as per resource: an override VEVENT carries its
 * own summary, status and transparency, and a range read that took them from
 * the master would draw the old title over an edited instance and count a
 * cancelled one as busy time.
 */
export type CalendarEventDisplay = Pick<
	CalendarObjectItem,
	"summary" | "status" | "transparency"
>;

export const projectEventDisplay = (
	component: ICAL.Component,
): CalendarEventDisplay => ({
	summary: readString(component, "summary"),
	status:
		STATUS_BY_ICAL[readString(component, "status").toUpperCase()] ??
		CalendarEventStatus.Confirmed,
	transparency:
		TRANSPARENCY_BY_ICAL[readString(component, "transp").toUpperCase()] ??
		CalendarTransparency.Opaque,
});

export const hasRecurrence = (calendar: ParsedCalendar): boolean =>
	calendar.master.hasProperty("rrule") ||
	calendar.master.hasProperty("rdate") ||
	calendar.overrides.length > 0;

export const projectCalendar = (
	calendar: ParsedCalendar,
	collectionTimezone: string,
): CalendarResult<CalendarObjectProjection> => {
	const event = new ICAL.Event(calendar.master);
	const start = resolveTime(
		event.startDate,
		tzidOf(calendar.master.getFirstProperty("dtstart")),
		collectionTimezone,
	);
	const end = resolveTime(
		event.endDate,
		tzidOf(
			calendar.master.getFirstProperty("dtend") ??
				calendar.master.getFirstProperty("dtstart"),
		),
		collectionTimezone,
	);

	if (end.instantMs < start.instantMs) {
		return calendarFailure(
			"BackwardsEnd",
			`the event ends at ${end.isoUtc}, before it starts at ${start.isoUtc}`,
		);
	}

	const sequence = calendar.master.getFirstPropertyValue("sequence");

	return {
		ok: true,
		value: {
			icalUid: calendar.uid,
			dtStart: start.isoOffset,
			dtEnd: end.isoOffset,
			allDay: start.isDate,
			zoneCertainty: start.certainty,
			...projectEventDisplay(calendar.master),
			hasRecurrence: hasRecurrence(calendar),
			sequence: typeof sequence === "number" ? sequence : 0,
		},
	};
};
