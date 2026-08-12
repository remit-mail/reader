/**
 * The grid itself: FullCalendar v7, styled entirely through its per-element
 * `*Class` props so every pixel comes from our tokens. v7 ships a structural
 * `skeleton.css` and nothing else — no theme is imported, and no rule in this
 * repo overrides one of the library's own, because there are none to override.
 *
 * The wrapper stays in the workbench rather than `@remit/ui`: `@remit/ui` is
 * published, and a design prototype has no business adding a calendar engine to
 * its dependency closure. The presentational pieces it composes — the chip, the
 * editor, the calendar list — do live in the kit and know nothing about
 * FullCalendar.
 */
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import listPlugin from "@fullcalendar/react/list";
import multiMonthPlugin from "@fullcalendar/react/multimonth";
import "@fullcalendar/react/skeleton.css";
import type { CalendarRef, EventApi, EventInput } from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import {
	addMinutesToClock,
	type CalendarColorId,
	type CalendarEventData,
	type CalendarViewId,
	calendarColorClasses,
	cn,
	type Density,
} from "@remit/ui";
import { Globe, Mail, Repeat } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { HOME_ZONE, NOW_ISO } from "../fixtures/calendar.js";

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
	comfortable: {
		slotMinutes: 30,
		slotMinHeight: 26,
		eventShortHeight: 34,
	},
	compact: {
		slotMinutes: 60,
		slotMinHeight: 15,
		eventShortHeight: 22,
	},
};

/** How long a new event is when nobody said — the same hour every other path starts from. */
const DRAFT_MINUTES = 60;

export interface SlotPick {
	/** `YYYY-MM-DD`. */
	date: string;
	/** `HH:MM`, empty when the pick landed in the all-day band. */
	startTime: string;
	endTime: string;
	allDay: boolean;
}

export interface CalendarGridProps {
	view: CalendarViewId;
	/** The day the view is centred on; changing it moves the grid. */
	date: string;
	events: CalendarEventData[];
	/** Which calendar owns which hue. Anything missing falls back to cal-1. */
	colorByCalendarId: Record<string, CalendarColorId>;
	density: Density;
	selectedEventId: string;
	onSelectEvent: (eventId: string) => void;
	onPickSlot: (pick: SlotPick) => void;
	/** The range title FullCalendar computed, e.g. "8 – 14 Jun 2026". */
	onRangeChange: (title: string) => void;
	className?: string;
}

interface EventMeta {
	calendarId: string;
	color: CalendarColorId;
	hasThread: boolean;
	isRecurring: boolean;
	zoneAmbiguous: boolean;
	declined: boolean;
	tentative: boolean;
}

function readMeta(event: EventApi): EventMeta {
	const raw: unknown = event.extendedProps.meta;
	if (raw && typeof raw === "object" && "color" in raw) return raw as EventMeta;
	return {
		calendarId: "",
		color: "cal-1",
		hasThread: false,
		isRecurring: false,
		zoneAmbiguous: false,
		declined: false,
		tentative: false,
	};
}

function toInput(event: CalendarEventData, color: CalendarColorId): EventInput {
	const meta: EventMeta = {
		calendarId: event.calendarId,
		color,
		hasThread: event.threadId !== "",
		isRecurring: event.recurrenceRule !== "",
		zoneAmbiguous: event.zoneCertainty === "ambiguous",
		declined: event.myRsvp === "declined",
		tentative: event.status === "tentative" || event.myRsvp === "tentative",
	};
	return {
		id: event.id,
		title: event.title,
		start: event.start,
		end: event.end,
		allDay: event.allDay,
		extendedProps: { meta },
	};
}

/**
 * Reads a pick off the ISO strings FullCalendar hands the callback rather than
 * off its `Date`. The calendar runs in `HOME_ZONE`; a `Date` read through
 * `getHours()` is that instant in the host's zone, so a UTC runner would draft
 * 09:00 for a click on 11:00.
 */
function rangePick(
	startStr: string,
	endStr: string,
	allDay: boolean,
): SlotPick {
	if (allDay)
		return {
			date: startStr.slice(0, 10),
			startTime: "",
			endTime: "",
			allDay: true,
		};
	return {
		date: startStr.slice(0, 10),
		startTime: startStr.slice(11, 16),
		endTime: endStr.slice(11, 16),
		allDay: false,
	};
}

/** A single point on the grid, which is an hour long because nothing said otherwise. */
function pointPick(dateStr: string, allDay: boolean): SlotPick {
	if (allDay)
		return {
			date: dateStr.slice(0, 10),
			startTime: "",
			endTime: "",
			allDay: true,
		};
	const startTime = dateStr.slice(11, 16);
	return {
		date: dateStr.slice(0, 10),
		startTime,
		endTime: addMinutesToClock(startTime, DRAFT_MINUTES),
		allDay: false,
	};
}

/**
 * Whether a selection was dragged across the grid rather than landing on it.
 * One slot, or one day, is as small as a selection gets, which is exactly what
 * a click leaves behind — and a click is already a pick of its own.
 */
function isDragged(
	startStr: string,
	endStr: string,
	allDay: boolean,
	slotMinutes: number,
): boolean {
	const span = Date.parse(endStr) - Date.parse(startStr);
	if (allDay) return Math.round(span / 86_400_000) > 1;
	return span / 60_000 > slotMinutes;
}

export function CalendarGrid({
	view,
	date,
	events,
	colorByCalendarId,
	density,
	selectedEventId,
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

	const eventInputs = useMemo(
		() =>
			events.map((event) =>
				toInput(event, colorByCalendarId[event.calendarId] ?? "cal-1"),
			),
		[events, colorByCalendarId],
	);

	/* The same shell `CalendarEventChip` draws, minus what FullCalendar owns: it
	   renders the event's element itself, so this is a class string rather than
	   the component. Every value here is the chip's — see its story. */
	const eventShell = useMemo(
		() => (info: { event: EventApi; isSelected: boolean }) => {
			const meta = readMeta(info.event);
			const hue = calendarColorClasses(meta.color);
			return cn(
				"min-w-0 cursor-pointer overflow-hidden rounded-sm text-2xs outline-none transition-colors",
				hue.soft,
				hue.text,
				meta.tentative && cn("border-y border-r border-dashed", hue.border),
				meta.declined && "opacity-60",
				info.event.id === selectedEventId && "ring-2 ring-ring",
			);
		},
		[selectedEventId],
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
				now={NOW_ISO}
				timeZone={HOME_ZONE}
				height="100%"
				headerToolbar={false}
				firstDay={1}
				nowIndicator
				selectable
				selectMirror
				editable={false}
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
						!isDragged(
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
				singleMonthClass="p-2"
				singleMonthHeaderClass="pb-1"
				singleMonthHeaderInnerClass="text-xs font-semibold text-fg"
				eventClass={eventShell}
				listItemEventClass={eventShell}
				columnEventClass={(info) =>
					cn(
						"border-l-2 px-1 py-0.5",
						calendarColorClasses(readMeta(info.event).color).rail,
					)
				}
				rowEventClass={(info) =>
					cn(
						"my-px border-l-2 px-1",
						calendarColorClasses(readMeta(info.event).color).rail,
					)
				}
				eventContent={(info) => {
					const meta = readMeta(info.event);
					/* A column an hour wide has room for a time or a title, never
					   both — the title is the one worth keeping. */
					const showTime = info.timeText !== "" && !isTight && !info.isNarrow;
					const isRow = info.event.allDay || ROW_VIEWS.has(view);
					const marks =
						meta.isRecurring || meta.hasThread || meta.zoneAmbiguous;
					return (
						<span
							className={cn(
								"flex min-w-0 items-center gap-1",
								isRow && "w-full",
								meta.declined && "line-through",
							)}
						>
							{showTime && (
								<span className="shrink-0 tabular-nums opacity-80">
									{info.timeText}
								</span>
							)}
							<span className="truncate font-medium">{info.event.title}</span>
							{marks && (
								<span
									className={cn(
										"flex shrink-0 items-center gap-1",
										isRow && "ml-auto",
									)}
								>
									{meta.isRecurring && (
										<Repeat className="size-2.5" aria-label="Repeats" />
									)}
									{meta.hasThread && (
										<Mail className="size-2.5" aria-label="From mail" />
									)}
									{meta.zoneAmbiguous && (
										<Globe
											className="size-2.5 text-warning"
											aria-label="Unclear zone"
										/>
									)}
								</span>
							)}
						</span>
					);
				}}
			/>
		</div>
	);
}
