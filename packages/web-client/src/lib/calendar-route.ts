/**
 * The calendar's address, read and written in one place.
 *
 * `/calendar/{view}/{date}` and, under it, the event a reader has open. The
 * five zoom levels are mutually exclusive and each is a different surface, so
 * the view is a path segment (R5); the date is one too, because the strip is
 * infinite and the address has to name where it opened — a `?date=` param
 * would be a query compensating for a missing segment (R4). What the reader
 * has ticked off modifies the view without changing what is mounted, so the
 * calendar filter is query (R2), validated here rather than at the read site
 * (R7).
 *
 * Nothing here reads a clock. Every function takes the instant it needs, so
 * "today" is a decision the caller makes once and this module can be tested
 * without one.
 */
import type { CalendarViewId } from "@remit/ui";
import { z } from "zod";

/** The zoom ladder, widest first. The union `@remit/ui` already publishes. */
export const calendarViews = [
	"year",
	"month",
	"week",
	"day",
	"agenda",
] as const satisfies readonly CalendarViewId[];

const calendarViewSchema = z.enum(calendarViews);

/** Where `/calendar` sends a reader who named no zoom of their own. */
export const DEFAULT_CALENDAR_VIEW: CalendarViewId = "week";

/**
 * The views the grid draws. Year and month are named surfaces that arrive in
 * later stages, and they say so on screen rather than matching a route that
 * renders nothing.
 */
const GRID_VIEWS = new Set<CalendarViewId>(["week", "day"]);

export const calendarViewMountsGrid = (view: CalendarViewId): boolean =>
	GRID_VIEWS.has(view);

/**
 * The one view the strip draws. It is a zoom of the same ladder rather than a
 * different screen: the grid is what a reader drops into for a day that has
 * earned it, and the strip is what they come back out to, with the day and the
 * ticked calendars they left with.
 */
export const calendarViewMountsAgenda = (view: CalendarViewId): boolean =>
	view === "agenda";

/** The view a segment names, or `undefined` where it names none. */
export function parseCalendarView(segment: string): CalendarViewId | undefined {
	const parsed = calendarViewSchema.safeParse(segment);
	return parsed.success ? parsed.data : undefined;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The day a segment names, or `undefined`. A date the calendar does not have —
 * the 31st of February, the 13th month — is not a day, so it is rejected
 * rather than rolled forward into one the reader did not ask for.
 */
export function parseCalendarDate(segment: string): string | undefined {
	if (!ISO_DATE.test(segment)) return undefined;
	const [year, month, day] = segment.split("-").map(Number);
	const instant = Date.UTC(year, month - 1, day);
	const round = new Date(instant);
	if (round.getUTCFullYear() !== year) return undefined;
	if (round.getUTCMonth() !== month - 1) return undefined;
	if (round.getUTCDate() !== day) return undefined;
	return segment;
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** The day an instant falls on, by the clock the reader's device is running. */
export function isoDate(instant: Date): string {
	return `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(
		instant.getDate(),
	)}`;
}

export interface CalendarParams {
	view: CalendarViewId;
	date: string;
}

/**
 * The address a pair of segments resolves to.
 *
 * A hand-edited or stale URL is a normal thing to receive, so an unreadable
 * segment is replaced rather than thrown: the half that was readable is kept,
 * and the reader lands on a calendar instead of an error. The caller compares
 * this with what it was given and redirects when they differ, so the address
 * bar ends up naming exactly what is on screen.
 */
export function canonicalCalendarParams(
	segments: { view: string; date: string },
	today: string,
): CalendarParams {
	return {
		view: parseCalendarView(segments.view) ?? DEFAULT_CALENDAR_VIEW,
		date: parseCalendarDate(segments.date) ?? today,
	};
}

/**
 * The day the previous or next screenful starts on. A step is measured in the
 * view's own unit, which is what makes back-and-forward land where the reader
 * came from at every zoom. Agenda steps a week, which is far enough to be worth
 * a press and near enough to stay inside the days it is already holding.
 */
export function stepCalendarDate(
	date: string,
	view: CalendarViewId,
	direction: -1 | 1,
): string {
	const [year, month, day] = date.split("-").map(Number);
	if (view === "year") return clampedDate(year + direction, month, day);
	if (view === "month") return clampedDate(year, month + direction, day);
	const days = view === "day" ? 1 : 7;
	const stepped = new Date(Date.UTC(year, month - 1, day + days * direction));
	return isoDateUtc(stepped);
}

const isoDateUtc = (instant: Date): string =>
	`${instant.getUTCFullYear()}-${pad(instant.getUTCMonth() + 1)}-${pad(
		instant.getUTCDate(),
	)}`;

/**
 * A month or a year away from a date, held to a day that month has. Stepping
 * off the 31st of March must land in February rather than skipping it.
 */
function clampedDate(year: number, month: number, day: number): string {
	const normalisedYear = year + Math.floor((month - 1) / 12);
	const normalisedMonth = ((((month - 1) % 12) + 12) % 12) + 1;
	const lastDay = new Date(
		Date.UTC(normalisedYear, normalisedMonth, 0),
	).getUTCDate();
	return `${normalisedYear}-${pad(normalisedMonth)}-${pad(
		Math.min(day, lastDay),
	)}`;
}

/**
 * A calendar's id, as the URL carries it.
 *
 * Deliberately looser than the id the API mints. An address is something people
 * paste, bookmark and hand-edit, and what to do with an id that names no
 * calendar is already settled downstream: the reader is shown the calendars
 * that do exist. Refusing the segment here would turn a stale link into an
 * error page instead of a calendar.
 */
const calendarIdSchema = z.string().min(1);

/**
 * The calendars a query string has ticked.
 *
 * Repeated `calendarId=` params are the shape, and the shape the address is
 * written back in (`lib/search-params.ts`). They arrive here in three readings
 * all the same: a list from repeated params, a scalar from a single one, and a
 * number where the id looked like one. One set of ticked calendars has one
 * spelling, which is what deduplicating and sorting is for.
 */
export function readCalendarIds(value: unknown): string[] {
	const raw = value === undefined || value === null ? [] : [value].flat();
	const named = new Set<string>();
	for (const entry of raw) {
		if (typeof entry !== "string" && typeof entry !== "number") continue;
		const id = calendarIdSchema.safeParse(String(entry));
		if (id.success) named.add(id.data);
	}
	return [...named].sort();
}

/**
 * What the calendar reads out of the query, and all of it.
 *
 * Ticking nothing off leaves the param out rather than writing an empty list:
 * the address states what a reader has narrowed to, so a calendar showing
 * everything is a calendar the query has nothing to say about.
 *
 * Density is absent on purpose: it is how much of a day this device fits on
 * screen, which is a preference the device holds (`lib/calendar-density.ts`)
 * rather than a fact about the view, so it belongs to no tier of the address.
 */
export const calendarSearchSchema = z.object({
	calendarId: z
		.preprocess(readCalendarIds, z.array(calendarIdSchema))
		.transform((ids) => (ids.length === 0 ? undefined : ids)),
});
