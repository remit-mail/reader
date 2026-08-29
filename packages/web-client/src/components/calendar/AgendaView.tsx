import {
	type AgendaScrollTarget,
	buildCalendarDay,
	type CalendarDay,
	type CalendarSlotPick,
	type Density,
	freeStretchesOn,
} from "@remit/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgendaStrip } from "@/components/calendar/AgendaStrip";
import {
	type AgendaRange,
	calendarInstanceId,
	datesInRange,
	extendRangeEnd,
	extendRangeStart,
	freeStretchesByDate,
	liftRangeCeiling,
	liftRangeFloor,
	rangeAround,
	rangeAtCeiling,
	rangeAtFloor,
	rangeCovering,
	readCalendarInstanceId,
	useCalendarEventWeeks,
	useCalendarFreeBusyWeeks,
	useCalendarSelection,
	useDrawnEvents,
	weekKeyOf,
	weekWindowsOver,
} from "@/hooks/calendar";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { isoDate } from "@/lib/calendar-route";
import {
	useCalendarAddress,
	useCalendarNavigation,
	useOpenCalendarEvent,
} from "@/routing";

/**
 * The agenda, bound to the address.
 *
 * The strip is the same continuous run of time the grid draws, at a zoom that
 * does not spend pixels on empty hours. Two facts of the address drive it and
 * nothing else does: the day it opened on, which the strip lands on, and the
 * calendars ticked in the query, which narrow what it draws. Switching to the
 * week grid and back changes neither, which is what "the grid is a zoom level
 * you drop into and leave" means in practice.
 *
 * The days it holds are fetched a week at a time, on the grid's own cache keys.
 * That is what lets the range grow at all — a single read may not cover more
 * than a year, and one request that widened every time the reader reached an
 * end would eventually be refused and replace the strip with the refusal — and
 * it is what makes the two zooms share everything they have already read.
 *
 * It grows on the reader's scroll and on nothing else, a week at a time, and
 * only as far as a year either way. Past that it says so and offers the next
 * stretch: a sparse diary draws shorter than the distance the strip fetches at,
 * so an end measured off the content alone is reached on the first layout pass
 * and never stops being reached.
 *
 * Scrolling writes the day back to the address, debounced and by `replace`.
 * Debounced because a flick past a fortnight is one move rather than fourteen,
 * and `replace` because scrolling is not somewhere a reader went — Back belongs
 * to the screen they came from, not to the row they scrolled past. Growing the
 * range writes nothing: days arriving at an end is not the reader moving.
 */

/** Long enough that a flick lands before the address moves. */
export const ANCHOR_DEBOUNCE_MS = 400;

export interface AgendaViewProps {
	/** The device preference the whole calendar reads. */
	density: Density;
	/**
	 * An empty slot the reader picked. The composer is seeded by the route, the
	 * same way the grid's picks are, so a slot picked off a free band and one
	 * dragged on the grid open the same form.
	 */
	onPickSlot: (pick: CalendarSlotPick) => void;
}

export function AgendaView({ density, onPickSlot }: AgendaViewProps) {
	const { date, calendarIds } = useCalendarAddress();
	const { openEvent, setAnchorDate, zoomToDay } = useCalendarNavigation();
	const opened = useOpenCalendarEvent();

	// One reading of the clock per mount. A strip that re-decided what "today"
	// meant on every render would move the day it is anchored to under a reader
	// who had not touched it.
	const [clock] = useState(() => new Date());
	const today = useMemo(() => isoDate(clock), [clock]);
	const now = useMemo(() => clock.toISOString(), [clock]);

	const [range, setRange] = useState<AgendaRange>(() => rangeAround(date));
	const [scrollTarget, setScrollTarget] = useState<AgendaScrollTarget>();
	const [visibleDate, setVisibleDate] = useState(date);
	const jumps = useRef(0);
	/*
	 * The day this view last put in the address. A date arriving that matches it
	 * is our own write coming back, and landing the strip on that would fight the
	 * scroll that caused it.
	 */
	const written = useRef(date);

	const land = useCallback((day: string) => {
		written.current = day;
		setVisibleDate(day);
		setRange((previous) => rangeCovering(previous, day));
		jumps.current += 1;
		setScrollTarget({ date: day, token: jumps.current });
	}, []);

	useEffect(() => {
		if (date === written.current) return;
		land(date);
	}, [date, land]);

	const anchor = useDebouncedValue(visibleDate, ANCHOR_DEBOUNCE_MS);
	useEffect(() => {
		if (anchor === written.current) return;
		written.current = anchor;
		setAnchorDate(anchor);
	}, [anchor, setAnchorDate]);

	const dates = useMemo(() => datesInRange(range), [range]);
	const windows = useMemo(() => weekWindowsOver(dates), [dates]);

	const {
		calendars,
		timeZoneByCalendarId,
		shown,
		narrowed,
		resolved,
		isLoading: loadingCalendars,
	} = useCalendarSelection(calendarIds);

	const events = useCalendarEventWeeks(windows, narrowed, resolved);
	const busy = useCalendarFreeBusyWeeks(windows);
	const drawn = useDrawnEvents(events.instances, timeZoneByCalendarId, shown);

	const days = useMemo(
		() => dates.map((day) => buildCalendarDay(day, drawn, today)),
		[dates, drawn, today],
	);

	/*
	 * A day whose week has not answered yet, or whose calendars are not known.
	 * It draws as a skeleton rather than as a day with nothing on it, because
	 * those two pictures are otherwise the same one and only one of them is true.
	 */
	const loadingDates = useMemo(() => {
		const pending = new Set<string>();
		if (loadingCalendars || !resolved) return new Set(dates);
		for (const day of dates) {
			if (events.pendingWindows.has(weekKeyOf(day))) pending.add(day);
		}
		return pending;
	}, [dates, events.pendingWindows, loadingCalendars, resolved]);

	/*
	 * Free time comes from the merged busy spans, which cover every calendar the
	 * reader holds rather than the ones the strip is drawing. A week whose spans
	 * have not landed falls back to the gaps between its own rows: calling an
	 * afternoon clear on the strength of nothing at all is the one mistake this
	 * view exists to avoid.
	 */
	const freeByDate = useMemo(
		() => freeStretchesByDate(dates, busy.spans),
		[dates, busy.spans],
	);
	const freeOn = useCallback(
		(day: CalendarDay) =>
			busy.pendingWindows.has(weekKeyOf(day.date))
				? freeStretchesOn(day)
				: (freeByDate.get(day.date) ?? freeStretchesOn(day)),
		[freeByDate, busy.pendingWindows],
	);

	const goToDate = useCallback(
		(day: string) => {
			land(day);
			setAnchorDate(day);
		},
		[land, setAnchorDate],
	);

	const selectEvent = useCallback(
		(eventId: string) => {
			const instance = readCalendarInstanceId(eventId);
			openEvent(instance.calendarObjectId, instance.recurrenceId);
		},
		[openEvent],
	);

	const growStart = useCallback(() => setRange(extendRangeStart), []);
	const growEnd = useCallback(() => setRange(extendRangeEnd), []);
	const loadEarlier = useCallback(() => setRange(liftRangeFloor), []);
	const loadLater = useCallback(() => setRange(liftRangeCeiling), []);

	/** Whichever read was refused is the one a retry re-sends. */
	const retry = useCallback(() => {
		events.refetch();
		busy.refetch();
	}, [events.refetch, busy.refetch]);

	return (
		<AgendaStrip
			days={days}
			calendars={calendars}
			density={density}
			today={today}
			anchorDate={date}
			now={now}
			selectedEventId={
				opened
					? calendarInstanceId(
							opened.calendarObjectId,
							opened.recurrenceId ?? "",
						)
					: ""
			}
			freeOn={freeOn}
			loadingDates={loadingDates}
			error={events.error ?? busy.error}
			onRetry={retry}
			scrollTarget={scrollTarget}
			onSelectEvent={selectEvent}
			onPickSlot={onPickSlot}
			onZoomDay={zoomToDay}
			onGoToDate={goToDate}
			onReachStart={growStart}
			onReachEnd={growEnd}
			atStartCap={rangeAtFloor(range)}
			atEndCap={rangeAtCeiling(range)}
			onLoadEarlier={loadEarlier}
			onLoadLater={loadLater}
			onVisibleDayChange={setVisibleDate}
		/>
	);
}
