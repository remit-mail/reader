import type {
	CalendarCollectionItem,
	CalendarObjectItem,
	CalendarOccurrenceInput,
	ICalendarEventIndexRepository,
	ICalendarObjectRepository,
} from "@remit/data-ports";
import { CalendarEventStatus, CalendarTransparency } from "@remit/domain-enums";
import { expandCalendarWindow } from "./expand.js";
import { parseCalendar } from "./parse.js";
import { toOffsetIso, toUtcIso } from "./time.js";

/**
 * How far before the window occurrences are read, so one that started earlier
 * and runs into it is still returned.
 *
 * The occurrence index is keyed by start, which is the only key a range read
 * can use, so an event that began before the window is invisible to it. A
 * bounded lookback buys back the events people actually have — a meeting that
 * started last night, a week away, a fortnight of leave — without turning a
 * day's read into a read of the whole calendar. An all-day block longer than
 * this that began before the window is the one thing it misses.
 */
export const CALENDAR_WINDOW_LOOKBACK_DAYS = 31;

const LOOKBACK_MS = CALENDAR_WINDOW_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

/** One occurrence, in the form a client renders. */
export interface CalendarInstance {
	calendarId: string;
	calendarObjectId: string;
	recurrenceId: string;
	icalUid: string;
	summary: string;
	/** ISO 8601 with the collection's own offset — what a client draws. */
	start: string;
	end: string;
	/** ISO 8601 UTC instant — what sorts and compares. */
	startAt: string;
	endAt: string;
	allDay: boolean;
	status: CalendarObjectItem["status"];
	transparency: CalendarObjectItem["transparency"];
	zoneCertainty: CalendarObjectItem["zoneCertainty"];
	etag: string;
	hasRecurrence: boolean;
}

export interface CalendarWindowRepositories {
	calendarObject: Pick<
		ICalendarObjectRepository,
		"find" | "listIncompleteExpansions"
	>;
	calendarEventIndex: Pick<ICalendarEventIndexRepository, "listByStartRange">;
}

export interface CalendarWindow {
	/** ISO 8601 UTC instant, inclusive. */
	from: string;
	/** ISO 8601 UTC instant, exclusive. */
	to: string;
}

const instanceOf = (
	collection: CalendarCollectionItem,
	object: CalendarObjectItem,
	occurrence: CalendarOccurrenceInput,
): CalendarInstance => ({
	calendarId: collection.calendarId,
	calendarObjectId: object.calendarObjectId,
	recurrenceId: occurrence.recurrenceId,
	icalUid: object.icalUid,
	summary: occurrence.summary,
	start: toOffsetIso(Date.parse(occurrence.startAt), collection.timezone),
	end: toOffsetIso(Date.parse(occurrence.endAt), collection.timezone),
	startAt: occurrence.startAt,
	endAt: occurrence.endAt,
	allDay: occurrence.allDay,
	status: occurrence.status,
	transparency: occurrence.transparency,
	zoneCertainty: object.zoneCertainty,
	etag: object.etag,
	hasRecurrence: object.hasRecurrence,
});

/**
 * Every occurrence in a window, across the collections given.
 *
 * Served from the stored occurrence index, except for the series the index
 * does not reach: those are expanded live for this window and nothing is
 * written to serve the read. A series is served from one source or the other,
 * never merged from both, so an occurrence cannot appear twice.
 */
export const listCalendarInstances = async (
	repositories: CalendarWindowRepositories,
	collections: CalendarCollectionItem[],
	window: CalendarWindow,
): Promise<CalendarInstance[]> => {
	const fromMs = Date.parse(window.from);
	const toMs = Date.parse(window.to);
	const lookbackFrom = toUtcIso(fromMs - LOOKBACK_MS);

	const instances: CalendarInstance[] = [];
	for (const collection of collections) {
		// Both reads are bounded by the window: the occurrence rows that start in
		// it, and the handful of series whose index stops short of it. Neither
		// grows with the size of the calendar.
		const live = await repositories.calendarObject.listIncompleteExpansions(
			collection.calendarId,
			window.to,
		);
		const liveIds = new Set(live.map((object) => object.calendarObjectId));
		const rows = await repositories.calendarEventIndex.listByStartRange(
			collection.calendarId,
			lookbackFrom,
			window.to,
		);

		// One read per resource that actually appears in the window, cached across
		// its own occurrences.
		const byId = new Map<string, CalendarObjectItem | null>();
		for (const row of rows) {
			if (liveIds.has(row.calendarObjectId)) continue;
			if (!byId.has(row.calendarObjectId)) {
				byId.set(
					row.calendarObjectId,
					await repositories.calendarObject.find(
						collection.calendarId,
						row.calendarObjectId,
					),
				);
			}
			const object = byId.get(row.calendarObjectId);
			if (!object) continue;
			instances.push(instanceOf(collection, object, row));
		}

		for (const object of live) {
			const parsed = await parseCalendar(object.icalData);
			if (!parsed.ok) {
				throw new Error(
					`stored calendar object ${object.calendarObjectId} no longer parses: ${parsed.error.message}`,
				);
			}
			const occurrences = expandCalendarWindow(
				parsed.value,
				collection.timezone,
				{ fromMs: fromMs - LOOKBACK_MS, toMs },
			);
			for (const occurrence of occurrences) {
				instances.push(instanceOf(collection, object, occurrence));
			}
		}
	}

	return instances
		.filter((instance) => overlapsWindow(instance, fromMs, toMs))
		.sort((left, right) => left.startAt.localeCompare(right.startAt));
};

const overlapsWindow = (
	instance: CalendarInstance,
	fromMs: number,
	toMs: number,
): boolean => {
	const startMs = Date.parse(instance.startAt);
	if (startMs >= toMs) return false;
	if (startMs >= fromMs) return true;
	return Date.parse(instance.endAt) > fromMs;
};

/** A stretch of time somebody is busy in, as instants. */
export interface BusySpan {
	startMs: number;
	endMs: number;
}

/**
 * Whether an occurrence consumes free/busy time. A cancelled event is not
 * something to work around, and one marked TRANSP:TRANSPARENT was written
 * precisely to say so.
 */
export const isBusy = (instance: CalendarInstance): boolean =>
	instance.transparency === CalendarTransparency.Opaque &&
	instance.status !== CalendarEventStatus.Cancelled;

/**
 * Collapses overlapping and touching spans into the stretches they cover.
 *
 * Touching counts: two meetings back to back are one stretch of being busy, and
 * reporting them separately invites a caller to offer the zero-length gap
 * between them as free.
 */
export const mergeBusySpans = (spans: BusySpan[]): BusySpan[] => {
	const sorted = [...spans].sort((left, right) => left.startMs - right.startMs);
	const merged: BusySpan[] = [];
	for (const span of sorted) {
		if (span.endMs <= span.startMs) continue;
		const last = merged[merged.length - 1];
		if (last && span.startMs <= last.endMs) {
			last.endMs = Math.max(last.endMs, span.endMs);
			continue;
		}
		merged.push({ ...span });
	}
	return merged;
};

/**
 * The busy stretches in a window, merged across every collection given, and
 * clipped to the window so a span never claims time outside what was asked
 * for.
 */
export const listBusySpans = async (
	repositories: CalendarWindowRepositories,
	collections: CalendarCollectionItem[],
	window: CalendarWindow,
): Promise<BusySpan[]> => {
	const fromMs = Date.parse(window.from);
	const toMs = Date.parse(window.to);
	const instances = await listCalendarInstances(
		repositories,
		collections,
		window,
	);
	return mergeBusySpans(
		instances.filter(isBusy).map((instance) => ({
			startMs: Math.max(Date.parse(instance.startAt), fromMs),
			endMs: Math.min(Date.parse(instance.endAt), toMs),
		})),
	);
};
