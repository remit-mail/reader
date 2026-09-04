import "../calendar.css";
import type {
	CalendarRef,
	EventDisplayInfo,
	EventInput,
} from "@fullcalendar/react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import listPlugin from "@fullcalendar/react/list";
import multiMonthPlugin from "@fullcalendar/react/multimonth";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import { useEffect, useMemo, useRef } from "react";
import { calendarEventBodyClasses } from "../lib/calendar-event-shell.js";
import {
	isDraggedSelection,
	pointPick,
	rangePick,
} from "../lib/calendar-slot-pick.js";
import { cn } from "../lib/cn.js";
import type { Density } from "./app-shell-types.js";
import { CalendarEventChipContent } from "./calendar-event-chip-content.js";
import type {
	CalendarColorId,
	CalendarEventData,
	CalendarSlotPick,
	CalendarViewId,
	RsvpState,
	ZoneCertainty,
} from "./calendar-types.js";

/**
 * One continuous strip of time, at whichever zoom the view names. Every pixel
 * comes from the kit's tokens: the calendar engine ships a structural skeleton
 * sheet and no theme, and it is styled entirely through its per-element
 * `*Class` props, so no rule here overrides one of the library's own.
 *
 * The component is presentational. It holds no events of its own, reads no
 * clock of its own, and every gesture leaves through a callback.
 */

const PLUGINS = [
	dayGridPlugin,
	timeGridPlugin,
	listPlugin,
	multiMonthPlugin,
	interactionPlugin,
];

const FC_VIEW: Record<CalendarViewId, string> = {
	year: "multiMonthYear",
	month: "dayGridMonth",
	week: "timeGridWeek",
	day: "timeGridDay",
	agenda: "listWeek",
};

/* A week or a day names the date in its header. A month grid repeats the same
   seven weekdays down the page, so the header names the weekday and the cells
   own the dates; a year has room for one letter. */
const DAY_HEADER_FORMAT: Record<
	CalendarViewId,
	{ weekday: "short" | "narrow"; day?: "numeric" }
> = {
	year: { weekday: "narrow" },
	month: { weekday: "short" },
	week: { weekday: "short", day: "numeric" },
	day: { weekday: "short", day: "numeric" },
	agenda: { weekday: "short", day: "numeric" },
};

/** Views that draw every event as a horizontal pill rather than a block. */
const ROW_VIEWS = new Set<CalendarViewId>(["year", "month", "agenda"]);

/**
 * Density is a real change in how much of a day fits on screen, not a padding
 * tweak: a tighter setting halves the slot height and drops the time off short
 * chips.
 */
const DENSITY: Record<
	Density,
	{ slotMinutes: number; slotMinHeight: number; eventShortHeight: number }
> = {
	comfortable: { slotMinutes: 30, slotMinHeight: 26, eventShortHeight: 34 },
	compact: { slotMinutes: 60, slotMinHeight: 15, eventShortHeight: 22 },
};

const FALLBACK_COLOR: CalendarColorId = "cal-1";

export interface CalendarGridProps {
	view: CalendarViewId;
	/** The day the view is centred on; changing it moves the grid. */
	date: string;
	events: CalendarEventData[];
	/** Which calendar owns which hue. Anything missing falls back to cal-1. */
	colorByCalendarId: Record<string, CalendarColorId>;
	density: Density;
	selectedEventId: string;
	/** IANA zone the grid's clock runs on, and the zone a pick is read in. */
	timeZone: string;
	/** The instant the grid calls now: the today marker and the now line read it. */
	now: string;
	onSelectEvent: (eventId: string) => void;
	onPickSlot: (pick: CalendarSlotPick) => void;
	/** The range title the grid computed, e.g. "8 – 14 Jun 2026". */
	onRangeChange: (title: string) => void;
	className?: string;
}

/**
 * What drawing one event needs, keyed by id. The engine renders the element and
 * hands the callback its own `EventApi`, so the data is looked up rather than
 * smuggled through `extendedProps` and cast back out.
 */
interface GridEvent {
	color: CalendarColorId;
	rsvp: RsvpState;
	status: "confirmed" | "tentative";
	hasThread: boolean;
	isRecurring: boolean;
	zoneCertainty: ZoneCertainty;
}

/** The placeholder the engine drags under the pointer, which is not one of ours. */
const MIRROR_EVENT: GridEvent = {
	color: FALLBACK_COLOR,
	rsvp: "accepted",
	status: "confirmed",
	hasThread: false,
	isRecurring: false,
	zoneCertainty: "local",
};

function toInput(event: CalendarEventData): EventInput {
	return {
		id: event.id,
		title: event.title,
		start: event.start,
		end: event.end,
		allDay: event.allDay,
	};
}

export function CalendarGrid({
	view,
	date,
	events,
	colorByCalendarId,
	density,
	selectedEventId,
	timeZone,
	now,
	onSelectEvent,
	onPickSlot,
	onRangeChange,
	className,
}: CalendarGridProps) {
	const calendarRef = useRef<CalendarRef>(null);

	useEffect(() => {
		calendarRef.current?.getApi().changeView(FC_VIEW[view]);
	}, [view]);

	useEffect(() => {
		calendarRef.current?.getApi().gotoDate(date);
	}, [date]);

	const eventInputs = useMemo(() => events.map(toInput), [events]);

	const byId = useMemo(
		() =>
			new Map<string, GridEvent>(
				events.map((event) => [
					event.id,
					{
						color: colorByCalendarId[event.calendarId] ?? FALLBACK_COLOR,
						rsvp: event.myRsvp,
						status: event.status,
						hasThread: event.threadId !== "",
						isRecurring: event.recurrenceRule !== "",
						zoneCertainty: event.zoneCertainty,
					},
				]),
			),
		[events, colorByCalendarId],
	);

	const lookup = useMemo(
		() => (id: string) => byId.get(id) ?? MIRROR_EVENT,
		[byId],
	);

	const isRowEvent = useMemo(
		() => (info: EventDisplayInfo) => info.event.allDay || ROW_VIEWS.has(view),
		[view],
	);

	/* The event element the engine built, dressed as the body of a
	   `CalendarEventChip`: same box, same hue, same states, one definition. A
	   grid cell is tight whatever the density does to the slots around it. */
	const eventBody = useMemo(
		() => (info: EventDisplayInfo) => {
			const event = lookup(info.event.id);
			const isRow = isRowEvent(info);
			return cn(
				calendarEventBodyClasses({
					color: event.color,
					layout: isRow ? "row" : "column",
					density: "compact",
					rsvp: event.rsvp,
					status: event.status,
					selected: info.event.id === selectedEventId,
					stacked: false,
				}),
				"cursor-pointer outline-none transition-colors",
				"focus-visible:ring-2 focus-visible:ring-ring",
				/* Tighter than a chip drawn on its own: a grid cell is smaller than
				   anywhere else an event lands, and an all-day pill has to fit a band
				   one line high. */
				isRow ? "my-px px-1 py-0" : "px-1 py-0.5",
			);
		},
		[lookup, isRowEvent, selectedEventId],
	);

	const slot = DENSITY[density];
	const isTight = density === "compact";

	return (
		<div className={cn("h-full min-h-0 w-full text-fg", className)}>
			<FullCalendar
				ref={calendarRef}
				plugins={PLUGINS}
				initialView={FC_VIEW[view]}
				initialDate={date}
				now={now}
				timeZone={timeZone}
				height="100%"
				headerToolbar={false}
				firstDay={1}
				nowIndicator
				selectable
				selectMirror
				editable={false}
				/* Events take focus and answer Enter, the way the toolbar's controls
				   do — the grid is not reachable by pointer only. */
				eventInteractive
				expandRows
				allDayText="All day"
				dayMaxEvents={isTight ? 2 : 3}
				eventMaxStack={3}
				moreLinkClick="popover"
				moreLinkText={(num) => `+${num}`}
				slotMinTime="07:00:00"
				slotMaxTime="23:00:00"
				scrollTime="08:30:00"
				scrollTimeReset={false}
				slotDuration={{ minutes: slot.slotMinutes }}
				slotMinHeight={slot.slotMinHeight}
				eventShortHeight={slot.eventShortHeight}
				displayEventEnd={false}
				eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
				slotHeaderFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
				dayHeaderFormat={DAY_HEADER_FORMAT[view]}
				events={eventInputs}
				eventClick={(info) => onSelectEvent(info.event.id)}
				/* One gesture, two readings, and each owns a shape the other cannot
				   reach. A point is `dateClick`'s: a finger has to hold a full second
				   before the library will call it a selection, and a selection cancels
				   the scroll the finger might have meant, so a tap has nowhere else to
				   land. A dragged range is `select`'s.

				   Acting on both would report a point twice, and the second report
				   arrives late — the library finishes a click a task after the pointer
				   is up — by which time the pane the first report opened has rebuilt
				   the grid and left the second reading a detached cell. */
				dateClick={(info) => onPickSlot(pointPick(info.dateStr, info.allDay))}
				select={(info) => {
					if (
						!isDraggedSelection(
							info.startStr,
							info.endStr,
							info.allDay,
							slot.slotMinutes,
						)
					) {
						/* The point reading is answering this one. Left alone the
						   selection would stay lit under the draft, a slot wide where
						   the draft is an hour, until a click somewhere else. */
						info.view.calendar.unselect();
						return;
					}
					onPickSlot(rangePick(info.startStr, info.endStr, info.allDay));
				}}
				datesSet={(info) => onRangeChange(info.view.title)}
				/* ---- chrome, all of it ours ---- */
				viewClass="bg-surface"
				tableClass="border-line"
				tableHeaderClass="bg-surface"
				fillerClass="border-line"
				dayHeaderRowClass="h-pane-header"
				dayHeaderClass={(info) =>
					cn(
						"border-b border-line bg-surface",
						info.isToday ? "text-accent" : "text-fg-subtle",
					)
				}
				dayHeaderInnerClass="px-1 py-1 text-2xs font-semibold uppercase tracking-wider"
				dayHeaderDividerClass="border-b border-line"
				dayCellClass={(info) =>
					cn("border-line", info.isOther && "bg-surface-sunken")
				}
				dayLaneClass={(info) => cn(info.isToday && "bg-accent-soft/40")}
				dayCellTopInnerClass={(info) =>
					cn(
						"px-1 py-0.5 text-2xs tabular-nums",
						info.isToday ? "font-semibold text-accent" : "text-fg-muted",
					)
				}
				dayRowClass="border-line"
				slotLaneClass={(info) =>
					cn("border-line", info.isMinor && "border-dashed")
				}
				slotHeaderClass="border-line"
				slotHeaderInnerClass="pr-1.5 text-2xs tabular-nums text-fg-subtle"
				slotHeaderDividerClass="border-r border-line"
				allDayHeaderClass="border-line"
				allDayHeaderInnerClass="px-1 text-2xs uppercase tracking-wider text-fg-subtle"
				allDayDividerClass="border-b border-line-strong"
				nonBusinessHoursClass="bg-surface-sunken"
				highlightClass="bg-accent-soft"
				nowIndicatorLineClass="border-t border-danger"
				nowIndicatorDotClass="bg-danger"
				moreLinkClass="rounded-sm bg-surface-sunken text-2xs font-semibold text-fg-muted hover:bg-line hover:text-fg"
				moreLinkInnerClass="px-1 py-0.5"
				popoverClass="rounded-lg border border-line bg-surface-raised shadow-xl shadow-black/20"
				popoverCloseClass="text-fg-subtle hover:text-fg"
				listDaysClass="bg-surface"
				listDayClass="border-line"
				listDayHeaderClass="border-y border-line bg-surface-sunken"
				listDayHeaderInnerClass="flex h-section-row items-center px-row-inset text-2xs font-semibold uppercase tracking-wider text-fg-subtle"
				listDayBodyClass="border-line"
				noEventsClass="p-10 text-center"
				noEventsInnerClass="text-sm text-fg-muted"
				noEventsContent="Nothing scheduled"
				singleMonthClass="p-2"
				singleMonthHeaderClass="pb-1"
				singleMonthHeaderInnerClass="text-xs font-semibold text-fg"
				eventClass={eventBody}
				listItemEventClass={eventBody}
				eventContent={(info) => {
					const event = lookup(info.event.id);
					/* A column an hour wide has room for a time or a title, never
					   both — the title is the one worth keeping. */
					const showTime = info.timeText !== "" && !isTight && !info.isNarrow;
					return (
						<CalendarEventChipContent
							title={info.event.title}
							timeText={showTime ? info.timeText : ""}
							layout={isRowEvent(info) ? "row" : "column"}
							rsvp={event.rsvp}
							hasThread={event.hasThread}
							isRecurring={event.isRecurring}
							zoneCertainty={event.zoneCertainty}
						/>
					);
				}}
			/>
		</div>
	);
}
