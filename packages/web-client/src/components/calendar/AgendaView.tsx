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
	agendaWindow,
	calendarInstanceId,
	datesInRange,
	deviceTimeZone,
	extendRangeEnd,
	extendRangeStart,
	freeStretchesByDate,
	isDrawnInstance,
	rangeAround,
	rangeCovering,
	readCalendarInstanceId,
	toCalendarEventData,
	useCalendarEventWindow,
	useCalendarFreeBusy,
	useCalendars,
} from "@/hooks/calendar";
import { selectCalendarIds } from "@/hooks/useCalendarData";
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
 * Scrolling writes the day back to the address, debounced and by `replace`.
 * Debounced because a flick past a fortnight is one move rather than fourteen,
 * and `replace` because scrolling is not somewhere a reader went — Back belongs
 * to the screen they came from, not to the row they scrolled past.
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

	const window = useMemo(() => agendaWindow(range), [range]);
	const dates = useMemo(() => datesInRange(range), [range]);

	const {
		calendars,
		timeZoneByCalendarId,
		isLoading: loadingCalendars,
	} = useCalendars();
	const shown = selectCalendarIds(calendars, calendarIds);
	// Asking for every calendar by name and asking for all of them are the same
	// question, so they share a cache entry with whatever the grid asked.
	const narrowed = shown.length === calendars.length ? [] : shown;
	// A tick list can only be resolved against calendars that have loaded.
	const resolved = calendarIds.length === 0 || calendars.length > 0;

	const events = useCalendarEventWindow({
		...window,
		calendarIds: narrowed,
		enabled: resolved,
	});
	const busy = useCalendarFreeBusy(window);

	const shownKey = shown.join(",");
	const instances = events.instances;
	const drawn = useMemo(() => {
		const device = deviceTimeZone();
		const visible = new Set(shownKey === "" ? [] : shownKey.split(","));
		return instances
			.filter(
				(instance) =>
					isDrawnInstance(instance) && visible.has(instance.calendarId),
			)
			.map((instance) =>
				toCalendarEventData(
					instance,
					timeZoneByCalendarId[instance.calendarId] ?? device,
				),
			);
	}, [instances, timeZoneByCalendarId, shownKey]);

	const days = useMemo(
		() => dates.map((day) => buildCalendarDay(day, drawn, today)),
		[dates, drawn, today],
	);

	/*
	 * Free time comes from the merged busy spans, which cover every calendar the
	 * reader holds rather than the ones the strip is drawing. Until that answer
	 * lands the gaps between the rows are the honest reading: calling an
	 * afternoon clear on the strength of nothing at all is the one mistake this
	 * view exists to avoid.
	 */
	const freeByDate = useMemo(
		() => (busy.isLoading ? undefined : freeStretchesByDate(dates, busy.spans)),
		[dates, busy.isLoading, busy.spans],
	);
	const freeOn = useCallback(
		(day: CalendarDay) => freeByDate?.get(day.date) ?? freeStretchesOn(day),
		[freeByDate],
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
			isLoading={loadingCalendars || events.isLoading}
			error={events.error ?? busy.error}
			onRetry={events.refetch}
			scrollTarget={scrollTarget}
			onSelectEvent={selectEvent}
			onPickSlot={onPickSlot}
			onZoomDay={zoomToDay}
			onGoToDate={goToDate}
			onReachStart={() => setRange(extendRangeStart)}
			onReachEnd={() => setRange(extendRangeEnd)}
			onVisibleDayChange={setVisibleDate}
		/>
	);
}
