/**
 * The strip: one scrolling list of days.
 *
 * A time grid spends its pixels in proportion to the hours it covers, which is
 * backwards — most days are mostly empty. This list spends them in proportion
 * to what is on the day: a booked hour gets a row, an empty day gets a line,
 * and a run of empty days gets one sentence. Free stretches are drawn, not
 * left as whitespace, because "your Thursday afternoon is clear" is the answer
 * people actually come to a calendar for.
 *
 * Scrolling never paginates. Reaching either end asks the owner for more days
 * and the scroll position is held across the insert, so the strip has no seams
 * and no page boundaries to lose your place at.
 *
 * Reaching an end is something a reader does, never something a layout is. A
 * sparse diary draws shorter than the distance either end is fetched at, so an
 * end measured off the content alone is reached the moment the strip mounts and
 * stays reached however many days arrive — which walked the range, and the
 * address with it, out into empty years. What asks for more days is a scroll
 * the reader drove, moving toward the end it asks about.
 */
import { CalendarOff, ChevronRight, Layers, MapPin, Users } from "lucide-react";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type AgendaRow,
	buildAgendaRows,
	busySpansOn,
	DAY_END_MINUTE,
	DAY_START_MINUTE,
	type FreeStretch,
	formatMinute,
	formatRunLabel,
	formatSpan,
	freeStretchesOn,
	groupOverlapping,
	minuteOfDay,
	monthLabel,
	weekdayLongLabel,
} from "../lib/agenda-time.js";
import { calendarColorClasses } from "../lib/calendar-color.js";
import { cn } from "../lib/cn.js";
import { CalendarEventChip } from "./calendar-event-chip.js";
import type {
	CalendarColorId,
	CalendarDay,
	CalendarDescriptor,
	CalendarEventData,
	CalendarSlotPick,
} from "./calendar-types.js";

/**
 * The reading of the strip, from a month at a glance to one event per card.
 * Three steps rather than two: a list can go further in both directions than a
 * grid can, and how far is the reader's call.
 */
export type AgendaDensity = "dots" | "pills" | "detail";

/** The sticky bar the anchors are measured against. */
const HEADER_HEIGHT = 32;

/** A stretch this long stops being a gap and becomes an afternoon. */
const LONG_FREE_MINUTES = 150;

/** The hue every calendar the caller did not describe falls back to. */
const FALLBACK_COLOR: CalendarColorId = "cal-1";

/** How close to either end a scroll has to come before more days are asked for. */
const REACH_BEHIND = 600;
const REACH_AHEAD = 900;

/**
 * How long after a wheel, a drag, a touch or a key a scroll is still the
 * reader's. Momentum and a held key both keep scrolling after the input stops;
 * a layout pass or a resize minutes later does not get to borrow the gesture.
 */
const INTENT_MS = 1_500;

/** Nothing outstanding, which is what a caller that never fetches has. */
const EMPTY_DATES: ReadonlySet<string> = new Set();

export interface AgendaScrollTarget {
	date: string;
	/** Changes on every request, so asking twice for the same day works. */
	token: number;
}

/** Which calendar owns which hue and name, resolved once per render. */
interface CalendarLookup {
	color: (calendarId: string) => CalendarColorId;
	name: (calendarId: string) => string;
}

function lookupOf(calendars: readonly CalendarDescriptor[]): CalendarLookup {
	const byId = new Map(calendars.map((calendar) => [calendar.id, calendar]));
	return {
		color: (calendarId) => byId.get(calendarId)?.color ?? FALLBACK_COLOR,
		name: (calendarId) => byId.get(calendarId)?.name ?? "",
	};
}

export interface AgendaFlowProps {
	/** Contiguous and ascending. */
	days: CalendarDay[];
	/** Whose hue and name every event on the strip is drawn with. */
	calendars: readonly CalendarDescriptor[];
	density: AgendaDensity;
	today: string;
	/** Never collapsed into a run, whatever is on it. */
	focusDate: string;
	selectedEventId: string;
	onSelectEvent: (eventId: string) => void;
	onPickSlot: (pick: CalendarSlotPick) => void;
	/** Drops out of the list into the day grid. */
	onZoomDay: (date: string) => void;
	onReachStart: () => void;
	onReachEnd: () => void;
	/** The day under the sticky header, for the position map. */
	onVisibleDayChange: (date: string) => void;
	/**
	 * The run has grown as far as it goes without being asked. The strip says so
	 * at that end and offers the reader the next stretch, rather than fetching
	 * its way across a decade nobody scrolled to.
	 */
	atStartCap?: boolean;
	atEndCap?: boolean;
	onLoadEarlier?: () => void;
	onLoadLater?: () => void;
	/**
	 * Days whose events have not arrived. They draw as a skeleton and are never
	 * collapsed into a run: a day nobody has heard back about is not a day with
	 * nothing on it, and "6 days with nothing booked" over an unanswered request
	 * is the one sentence this strip must never print.
	 */
	loadingDates?: ReadonlySet<string>;
	/**
	 * The free time on a day, where the owner knows more about it than the rows
	 * do. Busy time on a calendar the strip is not drawing is still not free, so
	 * an owner holding merged busy spans answers this from those. Absent falls
	 * back to the gaps between what is on screen.
	 */
	freeOn?: (day: CalendarDay) => FreeStretch[];
	scrollTarget?: AgendaScrollTarget;
	/**
	 * Rendered immediately above today, and landed on with it, so what's next is
	 * the first thing you see and the first thing that scrolls away.
	 */
	todayLead?: ReactNode;
	touch?: boolean;
	className?: string;
}

export function AgendaFlow({
	days,
	calendars,
	density,
	today,
	focusDate,
	selectedEventId,
	onSelectEvent,
	onPickSlot,
	onZoomDay,
	onReachStart,
	onReachEnd,
	onVisibleDayChange,
	atStartCap = false,
	atEndCap = false,
	onLoadEarlier,
	onLoadLater,
	loadingDates = EMPTY_DATES,
	freeOn = freeStretchesOn,
	scrollTarget,
	todayLead,
	touch,
	className,
}: AgendaFlowProps) {
	const scroller = useRef<HTMLDivElement>(null);
	const anchors = useRef(new Map<string, HTMLDivElement>());
	const previousFirst = useRef(days[0]?.date ?? "");
	const previousHeight = useRef(0);
	const askedStart = useRef("");
	const askedEnd = useRef("");
	const landed = useRef(false);
	/*
	 * Where the scroller was left, so the next scroll event can be read as a
	 * movement and in which direction. Every offset this component writes itself
	 * records itself here, which is what makes the take-back after a prepend, and
	 * the landing, read as no movement at all.
	 */
	const resting = useRef(0);
	/** When the reader last touched the strip. */
	const reached = useRef(0);
	const [visibleDate, setVisibleDate] = useState(focusDate);

	const lookup = useMemo(() => lookupOf(calendars), [calendars]);
	const rows = buildAgendaRows(days, [today, focusDate, ...loadingDates]);
	const firstDate = days[0]?.date ?? "";
	const lastDate = days[days.length - 1]?.date ?? "";

	/* Prepending days must not move what you are reading, so the scroll offset
	   takes back exactly the height that was inserted above it. */
	useLayoutEffect(() => {
		const element = scroller.current;
		if (!element) return;
		if (firstDate !== "" && firstDate < previousFirst.current)
			element.scrollTop += element.scrollHeight - previousHeight.current;
		previousFirst.current = firstDate;
		previousHeight.current = element.scrollHeight;
		resting.current = element.scrollTop;
	});

	/* Landing puts you on the focused day; after that the strip is yours. Rows
	   are still settling on the first frame — a web font swapping under a month
	   of them moves the target by whole days — so the landing is re-applied
	   until the layout it was measured against stops changing. */
	useEffect(() => {
		if (landed.current) return;
		const element = scroller.current;
		if (!element) return;
		landed.current = true;
		let dropped = false;
		const settle = () => {
			const anchor = anchors.current.get(focusDate);
			if (dropped || !anchor) return;
			element.scrollTop = anchor.offsetTop - HEADER_HEIGHT;
			resting.current = element.scrollTop;
		};
		settle();
		setVisibleDate(focusDate);
		const frame = requestAnimationFrame(settle);
		document.fonts?.ready.then(settle);
		return () => {
			dropped = true;
			cancelAnimationFrame(frame);
		};
	}, [focusDate]);

	useEffect(() => {
		if (!scrollTarget) return;
		const element = scroller.current;
		const anchor = anchors.current.get(scrollTarget.date);
		if (!element || !anchor) return;
		element.scrollTop = anchor.offsetTop - HEADER_HEIGHT;
		resting.current = element.scrollTop;
		setVisibleDate(scrollTarget.date);
		onVisibleDayChange(scrollTarget.date);
	}, [scrollTarget, onVisibleDayChange]);

	/*
	 * A wheel, a drag, a touch or a key: the strip is the reader's from here.
	 * Listened for natively rather than through React, because a `div` carrying
	 * key and pointer handlers has to claim a role to be one, and the strip is a
	 * scroller rather than a control — announcing it as one would be a lie told
	 * to a screen reader for the sake of a lint rule.
	 */
	useEffect(() => {
		const element = scroller.current;
		if (!element) return;
		const note = () => {
			reached.current = Date.now();
		};
		const kinds = [
			"wheel",
			"pointerdown",
			"touchstart",
			"touchmove",
			"keydown",
		];
		for (const kind of kinds)
			element.addEventListener(kind, note, { passive: true });
		return () => {
			for (const kind of kinds) element.removeEventListener(kind, note);
		};
	}, []);

	const handleScroll = () => {
		const element = scroller.current;
		if (!element) return;

		const top = element.scrollTop;
		const moved = top - resting.current;
		resting.current = top;

		/* Everything below follows the reader and only the reader. A mount, a
		   resize, a font swap and the offset taken back after a prepend all raise
		   this event without anybody having scrolled, and answering them is how
		   the range and the address walked off on their own. */
		if (moved === 0 || Date.now() - reached.current > INTENT_MS) return;

		const seen = [...anchors.current.entries()]
			.filter(([, node]) => node.isConnected)
			.sort((a, b) => a[1].offsetTop - b[1].offsetTop);
		let current = "";
		for (const [date, node] of seen) {
			if (node.offsetTop - HEADER_HEIGHT - 8 > top) break;
			current = date;
		}
		if (current !== "" && current !== visibleDate) {
			setVisibleDate(current);
			onVisibleDayChange(current);
		}

		if (moved < 0 && top < REACH_BEHIND && askedStart.current !== firstDate) {
			askedStart.current = firstDate;
			onReachStart();
		}
		if (
			moved > 0 &&
			top + element.clientHeight > element.scrollHeight - REACH_AHEAD &&
			askedEnd.current !== lastDate
		) {
			askedEnd.current = lastDate;
			onReachEnd();
		}
	};

	const registerAnchor = (date: string) => (node: HTMLDivElement | null) => {
		if (node) anchors.current.set(date, node);
		else anchors.current.delete(date);
	};

	return (
		<div
			ref={scroller}
			onScroll={handleScroll}
			data-testid="agenda-strip"
			className={cn(
				"relative min-h-0 flex-1 overflow-y-auto bg-surface",
				className,
			)}
		>
			<div className="sticky top-0 z-20 flex h-8 items-center gap-2 border-b border-line bg-surface/95 px-row-inset backdrop-blur">
				<span className="text-xs font-semibold text-fg">
					{weekdayLongLabel(visibleDate)}
				</span>
				<span className="text-xs text-fg-subtle">
					{monthLabel(visibleDate)}
				</span>
				{visibleDate === today && (
					<span className="rounded-full bg-accent-soft px-1.5 text-2xs font-medium text-accent">
						Today
					</span>
				)}
			</div>

			{atStartCap && onLoadEarlier && (
				<CapEdge
					label="Show earlier days"
					testId="agenda-load-earlier"
					onLoad={onLoadEarlier}
					touch={touch}
				/>
			)}

			{rows.map((row) => (
				<FlowRow
					key={row.key}
					row={row}
					lookup={lookup}
					density={density}
					today={today}
					pending={row.kind === "day" && loadingDates.has(row.day.date)}
					freeOn={freeOn}
					selectedEventId={selectedEventId}
					onSelectEvent={onSelectEvent}
					onPickSlot={onPickSlot}
					onZoomDay={onZoomDay}
					anchorRef={registerAnchor(
						row.kind === "day" ? row.day.date : row.from,
					)}
					lead={row.kind === "day" && row.day.date === today ? todayLead : null}
					touch={touch}
				/>
			))}

			{atEndCap && onLoadLater && (
				<CapEdge
					label="Show later days"
					testId="agenda-load-later"
					onLoad={onLoadLater}
					touch={touch}
				/>
			)}
		</div>
	);
}

/**
 * Where the run stops growing on its own. A year either way is further than a
 * reader scrolls in one sitting, so this is rarely on screen — and when it is,
 * the next stretch costs a click rather than arriving because the strip decided
 * it had reached the end of itself.
 */
function CapEdge({
	label,
	testId,
	onLoad,
	touch,
}: {
	label: string;
	testId: string;
	onLoad: () => void;
	touch?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onLoad}
			data-testid={testId}
			className={cn(
				"flex w-full items-center justify-center gap-2 border-y border-dashed border-line bg-surface-sunken px-row-inset text-xs font-medium text-fg-muted outline-none transition-colors hover:border-accent hover:text-accent focus-visible:ring-2 focus-visible:ring-ring",
				touch ? "min-h-14 py-3" : "py-2",
			)}
		>
			{label}
		</button>
	);
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

interface RowProps {
	row: AgendaRow;
	lookup: CalendarLookup;
	density: AgendaDensity;
	today: string;
	/** This day's events have not arrived yet. */
	pending: boolean;
	freeOn: (day: CalendarDay) => FreeStretch[];
	selectedEventId: string;
	onSelectEvent: (eventId: string) => void;
	onPickSlot: (pick: CalendarSlotPick) => void;
	onZoomDay: (date: string) => void;
	anchorRef: (node: HTMLDivElement | null) => void;
	lead?: ReactNode;
	touch?: boolean;
}

function FlowRow({
	row,
	lookup,
	density,
	today,
	pending,
	freeOn,
	selectedEventId,
	onSelectEvent,
	onPickSlot,
	onZoomDay,
	anchorRef,
	lead,
	touch,
}: RowProps) {
	if (row.kind === "run")
		return (
			<div ref={anchorRef}>
				<EmptyRun
					from={row.from}
					to={row.to}
					days={row.days}
					onPickSlot={onPickSlot}
					touch={touch}
				/>
			</div>
		);

	if (pending)
		return (
			<div ref={anchorRef}>
				<PendingDay day={row.day} today={today} />
			</div>
		);

	if (density === "dots")
		return (
			<div ref={anchorRef}>
				{lead}
				<DotsDay
					day={row.day}
					lookup={lookup}
					today={today}
					freeOn={freeOn}
					onSelectEvent={onSelectEvent}
					onZoomDay={onZoomDay}
					selectedEventId={selectedEventId}
				/>
			</div>
		);

	return (
		<div ref={anchorRef}>
			{lead}
			<DayBlock
				day={row.day}
				lookup={lookup}
				density={density}
				today={today}
				freeOn={freeOn}
				selectedEventId={selectedEventId}
				onSelectEvent={onSelectEvent}
				onPickSlot={onPickSlot}
				onZoomDay={onZoomDay}
				touch={touch}
			/>
		</div>
	);
}

/**
 * A run of days with nothing on them at all. Six blank screens is a worse
 * answer to "am I free that week" than one line saying so.
 */
function EmptyRun({
	from,
	to,
	days,
	onPickSlot,
	touch,
}: {
	from: string;
	to: string;
	days: number;
	onPickSlot: (pick: CalendarSlotPick) => void;
	touch?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={() =>
				onPickSlot({
					date: from,
					startTime: "10:00",
					endTime: "11:00",
					allDay: false,
				})
			}
			className={cn(
				"flex w-full items-center gap-3 border-y border-dashed border-line bg-surface-sunken px-row-inset text-left outline-none transition-colors hover:border-accent focus-visible:ring-2 focus-visible:ring-ring",
				touch ? "min-h-14 py-3" : "py-2",
			)}
		>
			<CalendarOff className="size-4 shrink-0 text-accent" />
			<span className="text-sm font-medium text-fg">
				{formatRunLabel(from, to)}
			</span>
			<span className="text-xs text-fg-muted">
				{days} days with nothing booked
			</span>
			<span className="ml-auto shrink-0 text-2xs text-fg-subtle">Add</span>
		</button>
	);
}

/**
 * A day still being fetched. It keeps the date column, so the strip has the
 * shape it will have once the answer lands and nothing jumps under the reader,
 * and it says nothing at all about what is on the day.
 */
function PendingDay({ day, today }: { day: CalendarDay; today: string }) {
	const isToday = day.date === today;
	return (
		<section
			aria-busy="true"
			data-testid={`agenda-day-pending-${day.date}`}
			className={cn(
				"border-b border-line",
				isToday && "border-l-2 border-l-accent bg-accent-soft/20",
			)}
		>
			<header className="flex h-section-row items-center gap-3 px-row-inset">
				<div className="flex w-16 shrink-0 items-baseline gap-1.5">
					<span
						className={cn(
							"text-lg font-semibold tabular-nums",
							isToday ? "text-accent" : "text-fg",
						)}
					>
						{day.dayNumber}
					</span>
					<span className="text-2xs uppercase tracking-wider text-fg-subtle">
						{day.weekdayLabel}
					</span>
				</div>
				<span className="sr-only">Loading {day.date}</span>
				<span className="h-3 min-w-0 flex-1 animate-pulse rounded-full bg-surface-sunken" />
			</header>
			<div className="flex flex-col gap-1 pb-2">
				<span className="mx-row-inset h-7 animate-pulse rounded-md bg-surface-sunken" />
			</div>
		</section>
	);
}

/** The month-at-a-glance reading: one line a day, colour and shape only. */
function DotsDay({
	day,
	lookup,
	today,
	freeOn,
	selectedEventId,
	onSelectEvent,
	onZoomDay,
}: {
	day: CalendarDay;
	lookup: CalendarLookup;
	today: string;
	freeOn: (day: CalendarDay) => FreeStretch[];
	selectedEventId: string;
	onSelectEvent: (eventId: string) => void;
	onZoomDay: (date: string) => void;
}) {
	const isToday = day.date === today;
	const all = [...day.allDay, ...day.timed];

	return (
		<div
			className={cn(
				"flex h-8 items-center gap-2 border-b border-line px-row-inset",
				isToday && "bg-accent-soft/30",
			)}
		>
			<button
				type="button"
				onClick={() => onZoomDay(day.date)}
				className={cn(
					"w-16 shrink-0 rounded-sm text-left text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
					isToday ? "font-semibold text-accent" : "text-fg-muted",
				)}
			>
				{day.weekdayLabel} {day.dayNumber}
			</button>
			<div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
				{all.map((event) => (
					<button
						key={event.id}
						type="button"
						title={event.title}
						aria-label={event.title}
						aria-pressed={event.id === selectedEventId}
						onClick={() => onSelectEvent(event.id)}
						className={cn(
							"size-2 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
							calendarColorClasses(lookup.color(event.calendarId)).solid,
							event.id === selectedEventId && "ring-2 ring-ring",
							event.myRsvp === "declined" && "opacity-40",
						)}
					/>
				))}
			</div>
			<BusyBar day={day} className="w-24 shrink-0" />
			<span className="w-24 shrink-0 text-right text-2xs text-fg-subtle">
				{glanceLabel(day, freeOn)}
			</span>
		</div>
	);
}

/** What the day is worth saying in eleven characters. */
function glanceLabel(
	day: CalendarDay,
	freeOn: (day: CalendarDay) => FreeStretch[],
): string {
	const free = freeOn(day);
	if (day.timed.length === 0 && isWholeDayFree(free)) return "clear";
	const longest = free.reduce(
		(best, stretch) => Math.max(best, stretch.minutes),
		0,
	);
	if (longest >= LONG_FREE_MINUTES) return `${formatSpan(longest)} free`;
	return `${formatSpan(day.busyMinutes)} booked`;
}

/** Nothing takes an hour out of this day, whoever measured it. */
function isWholeDayFree(free: readonly FreeStretch[]): boolean {
	return free.length === 1 && free[0].wholeDay;
}

function DayBlock({
	day,
	lookup,
	density,
	today,
	freeOn,
	selectedEventId,
	onSelectEvent,
	onPickSlot,
	onZoomDay,
	touch,
}: {
	day: CalendarDay;
	lookup: CalendarLookup;
	density: AgendaDensity;
	today: string;
	freeOn: (day: CalendarDay) => FreeStretch[];
	selectedEventId: string;
	onSelectEvent: (eventId: string) => void;
	onPickSlot: (pick: CalendarSlotPick) => void;
	onZoomDay: (date: string) => void;
	touch?: boolean;
}) {
	const isToday = day.date === today;
	const groups = groupOverlapping(day.timed);
	const measured = freeOn(day);
	const free = measured.filter((stretch) => !stretch.wholeDay);
	/* Nothing on the strip and nothing taking the day out from anywhere else.
	   A day whose hours went to a calendar the reader has unticked is not free,
	   so it draws its bands rather than the line that says it is clear. */
	const clear = day.timed.length === 0 && isWholeDayFree(measured);

	const items: {
		key: string;
		at: number;
		node: ReactNode;
	}[] = [
		...groups.map((group) => ({
			key: group[0].id,
			at: minuteOfDay(group[0].start),
			node:
				group.length === 1 ? (
					<EventLine
						event={group[0]}
						lookup={lookup}
						density={density}
						selected={group[0].id === selectedEventId}
						onSelect={() => onSelectEvent(group[0].id)}
						touch={touch}
					/>
				) : (
					<ClashGroup
						events={group}
						lookup={lookup}
						density={density}
						selectedEventId={selectedEventId}
						onSelectEvent={onSelectEvent}
						onZoomDay={() => onZoomDay(day.date)}
						touch={touch}
					/>
				),
		})),
		...free.map((stretch) => ({
			key: `free_${stretch.startMinute}`,
			at: stretch.startMinute,
			node: (
				<FreeBand
					stretch={stretch}
					onPick={() =>
						onPickSlot({
							date: stretch.date,
							startTime: formatMinute(stretch.startMinute),
							endTime: formatMinute(
								Math.min(stretch.startMinute + 60, stretch.endMinute),
							),
							allDay: false,
						})
					}
					touch={touch}
				/>
			),
		})),
	].sort((a, b) => a.at - b.at);

	return (
		<section
			className={cn(
				"border-b border-line",
				isToday && "border-l-2 border-l-accent bg-accent-soft/20",
			)}
		>
			<header className="flex h-section-row items-center gap-3 px-row-inset">
				<div className="flex w-16 shrink-0 items-baseline gap-1.5">
					<span
						className={cn(
							"text-lg font-semibold tabular-nums",
							isToday ? "text-accent" : "text-fg",
						)}
					>
						{day.dayNumber}
					</span>
					<span className="text-2xs uppercase tracking-wider text-fg-subtle">
						{day.weekdayLabel}
					</span>
				</div>
				<span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
					{summarise(day)}
				</span>
				<BusyBar day={day} className="hidden w-32 shrink-0 sm:block" />
				<button
					type="button"
					onClick={() => onZoomDay(day.date)}
					className={cn(
						"flex shrink-0 items-center gap-0.5 rounded-md border px-2 text-2xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
						touch ? "min-h-9" : "h-6",
						day.conflicts.length > 0
							? "border-warning text-warning hover:bg-warning-soft"
							: "border-line text-fg-subtle hover:border-line-strong hover:text-fg",
					)}
				>
					Grid
					<ChevronRight className="size-3" />
				</button>
			</header>

			<div className="flex flex-col gap-1 pb-2">
				{day.allDay.map((event) => (
					<AllDayLine
						key={event.id}
						event={event}
						lookup={lookup}
						density={density}
						selected={event.id === selectedEventId}
						onSelect={() => onSelectEvent(event.id)}
						touch={touch}
					/>
				))}
				{clear ? (
					<ClearDayLine day={day} onPickSlot={onPickSlot} touch={touch} />
				) : (
					items.map((item) => <div key={item.key}>{item.node}</div>)
				)}
			</div>
		</section>
	);
}

function summarise(day: CalendarDay): string {
	if (day.timed.length === 0) return "Nothing booked";
	const parts = [
		`${day.timed.length} ${day.timed.length === 1 ? "event" : "events"}`,
		`${formatSpan(day.busyMinutes)} booked`,
	];
	if (day.conflicts.length > 0)
		parts.push(
			`${day.conflicts.length} ${day.conflicts.length === 1 ? "clash" : "clashes"}`,
		);
	return parts.join(" · ");
}

/** Where the day's hours went, drawn to scale. The gaps are the point. */
function BusyBar({ day, className }: { day: CalendarDay; className?: string }) {
	const span = DAY_END_MINUTE - DAY_START_MINUTE;
	return (
		<div
			aria-hidden
			className={cn(
				"relative h-1.5 overflow-hidden rounded-full bg-surface-sunken",
				className,
			)}
		>
			{busySpansOn(day).map((busy) => {
				const from = Math.max(busy.from, DAY_START_MINUTE);
				const to = Math.min(busy.to, DAY_END_MINUTE);
				if (to <= from) return null;
				return (
					<span
						key={`${busy.from}-${busy.to}`}
						className="absolute inset-y-0 rounded-full bg-fg-subtle"
						style={{
							left: `${((from - DAY_START_MINUTE) / span) * 100}%`,
							width: `${((to - from) / span) * 100}%`,
						}}
					/>
				);
			})}
		</div>
	);
}

function ClearDayLine({
	day,
	onPickSlot,
	touch,
}: {
	day: CalendarDay;
	onPickSlot: (pick: CalendarSlotPick) => void;
	touch?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={() =>
				onPickSlot({
					date: day.date,
					startTime: "10:00",
					endTime: "11:00",
					allDay: false,
				})
			}
			className={cn(
				"mx-row-inset flex items-center gap-2 rounded-md border border-dashed border-line px-2 text-left text-xs text-fg-muted outline-none transition-colors hover:border-accent hover:text-accent focus-visible:ring-2 focus-visible:ring-ring",
				touch ? "min-h-11" : "h-8",
			)}
		>
			Free all day
		</button>
	);
}

function FreeBand({
	stretch,
	onPick,
	touch,
}: {
	stretch: FreeStretch;
	onPick: () => void;
	touch?: boolean;
}) {
	const long = stretch.minutes >= LONG_FREE_MINUTES;
	return (
		<button
			type="button"
			onClick={onPick}
			className={cn(
				"ml-16 mr-row-inset flex items-center gap-2 rounded-md border border-dashed text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
				touch ? "min-h-11 px-3" : "h-7 px-2",
				long
					? "border-accent-2 bg-accent-2-soft/40 text-accent-2 hover:bg-accent-2-soft"
					: "border-line text-fg-subtle hover:border-line-strong hover:text-fg-muted",
			)}
		>
			<span className={cn("text-xs", long && "font-medium")}>
				{formatSpan(stretch.minutes)} free
			</span>
			<span className="text-2xs tabular-nums opacity-80">
				{formatMinute(stretch.startMinute)} – {formatMinute(stretch.endMinute)}
			</span>
		</button>
	);
}

function chipDensity(density: AgendaDensity) {
	return density === "detail" ? ("comfortable" as const) : ("compact" as const);
}

function AllDayLine({
	event,
	lookup,
	density,
	selected,
	onSelect,
	touch,
}: {
	event: CalendarEventData;
	lookup: CalendarLookup;
	density: AgendaDensity;
	selected: boolean;
	onSelect: () => void;
	touch?: boolean;
}) {
	return (
		<div className={cn("mx-row-inset", touch && "min-h-11")}>
			<CalendarEventChip
				title={event.title}
				timeText=""
				color={lookup.color(event.calendarId)}
				layout="row"
				density={chipDensity(density)}
				rsvp={event.myRsvp}
				status={event.status}
				hasThread={event.threadId !== ""}
				isRecurring={event.recurrenceRule !== ""}
				zoneCertainty={event.zoneCertainty}
				selected={selected}
				onClick={onSelect}
				trailing={<span className="text-2xs">All day</span>}
			/>
		</div>
	);
}

/**
 * Events that run into each other, kept together and named as a pile-up. This
 * is the one thing a list genuinely cannot draw, so it says so and offers the
 * grid rather than pretending the rows are the whole truth.
 */
function ClashGroup({
	events,
	lookup,
	density,
	selectedEventId,
	onSelectEvent,
	onZoomDay,
	touch,
}: {
	events: CalendarEventData[];
	lookup: CalendarLookup;
	density: AgendaDensity;
	selectedEventId: string;
	onSelectEvent: (eventId: string) => void;
	onZoomDay: () => void;
	touch?: boolean;
}) {
	const from = Math.min(...events.map((event) => minuteOfDay(event.start)));
	const to = Math.max(...events.map((event) => minuteOfDay(event.end)));
	return (
		<div className="mx-row-inset rounded-md border border-warning/50 bg-warning-soft/30">
			<div className="flex items-center gap-2 px-2 py-1">
				<Layers className="size-3 shrink-0 text-warning" />
				<span className="text-2xs font-medium text-warning">
					{events.length} at once · {formatMinute(from)} – {formatMinute(to)}
				</span>
				<button
					type="button"
					onClick={onZoomDay}
					className={cn(
						"ml-auto rounded-sm px-1.5 text-2xs font-medium text-warning underline underline-offset-2 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring",
						touch && "min-h-9",
					)}
				>
					Open the grid
				</button>
			</div>
			<div className="flex flex-col gap-0.5 pb-1">
				{events.map((event) => (
					<EventLine
						key={event.id}
						event={event}
						lookup={lookup}
						density={density}
						selected={event.id === selectedEventId}
						onSelect={() => onSelectEvent(event.id)}
						inset={false}
						touch={touch}
					/>
				))}
			</div>
		</div>
	);
}

function EventLine({
	event,
	lookup,
	density,
	selected,
	onSelect,
	inset = true,
	touch,
}: {
	event: CalendarEventData;
	lookup: CalendarLookup;
	density: AgendaDensity;
	selected: boolean;
	onSelect: () => void;
	inset?: boolean;
	touch?: boolean;
}) {
	const detailed = density === "detail";
	const minutes = minuteOfDay(event.end) - minuteOfDay(event.start);
	const second = [lookup.name(event.calendarId), event.location]
		.filter((part) => part !== "")
		.join(" · ");

	return (
		<div className={cn(inset ? "px-row-inset" : "px-2", touch && "min-h-12")}>
			<CalendarEventChip
				title={event.title}
				timeText=""
				color={lookup.color(event.calendarId)}
				layout="row"
				density={chipDensity(density)}
				rsvp={event.myRsvp}
				status={event.status}
				hasThread={event.threadId !== ""}
				isRecurring={event.recurrenceRule !== ""}
				zoneCertainty={event.zoneCertainty}
				selected={selected}
				onClick={onSelect}
				leading={
					<span
						className={cn(
							"shrink-0 pt-1 text-2xs tabular-nums text-fg-subtle",
							inset ? "w-14" : "w-11",
						)}
					>
						{event.start.slice(11, 16)}
						{detailed && (
							<span className="block opacity-70">
								{event.end.slice(11, 16)}
							</span>
						)}
					</span>
				}
				trailing={
					<span className="text-2xs tabular-nums">{formatSpan(minutes)}</span>
				}
				detail={
					detailed && second !== "" ? (
						<span className="flex min-w-0 items-center gap-2 text-2xs opacity-80">
							{event.location !== "" && <MapPin className="size-3 shrink-0" />}
							<span className="truncate">{second}</span>
							{event.attendees.length > 0 && (
								<span className="ml-auto flex shrink-0 items-center gap-0.5">
									<Users className="size-3" />
									{event.attendees.length}
								</span>
							)}
						</span>
					) : undefined
				}
			/>
		</div>
	);
}
