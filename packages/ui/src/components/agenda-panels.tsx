/**
 * The readings that sit beside the strip.
 *
 * A wide screen given to a single column of days wastes it as badly as a grid
 * wastes a sparse week, so the width goes to the questions the list is good at:
 * what is next, where the free time is, and where in the strip you currently
 * are. None of them is a second copy of the list — each one answers something
 * the rows cannot answer at a glance.
 */

import type { LucideIcon } from "lucide-react";
import {
	AlignJustify,
	CalendarOff,
	Clock,
	LayoutList,
	MoreHorizontal,
	Radio,
	Sun,
} from "lucide-react";
import { type ReactNode, useId, useMemo } from "react";
import {
	addDays,
	DAY_END_MINUTE,
	DAY_START_MINUTE,
	datesBetween,
	type FreeStretch,
	formatMinute,
	formatShortDay,
	formatSpan,
	type NextUp,
	shortMonthLabel,
} from "../lib/agenda-time.js";
import { calendarColorClasses } from "../lib/calendar-color.js";
import { cn } from "../lib/cn.js";
import type { AgendaDensity } from "./agenda-flow.js";
import { segmentClassName } from "./calendar-toolbar.js";
import type {
	CalendarColorId,
	CalendarDay,
	CalendarDescriptor,
} from "./calendar-types.js";

/* ------------------------------------------------------------------ */
/* Density                                                             */
/* ------------------------------------------------------------------ */

const DENSITY_OPTIONS: {
	value: AgendaDensity;
	label: string;
	Icon: LucideIcon;
}[] = [
	{ value: "dots", label: "Dots", Icon: MoreHorizontal },
	{ value: "pills", label: "Rows", Icon: AlignJustify },
	{ value: "detail", label: "Detail", Icon: LayoutList },
];

export interface AgendaDensityControlProps {
	value: AgendaDensity;
	onChange: (density: AgendaDensity) => void;
	/** Where the words do not fit — a phone's bottom bar. */
	icons?: boolean;
	touch?: boolean;
	className?: string;
}

/**
 * Three steps, not two. A list can be read as a month of coloured dots or as a
 * stack of cards, and which one is right depends on the day and the person, so
 * the control is on screen at every width rather than in a settings page.
 */
export function AgendaDensityControl({
	value,
	onChange,
	icons,
	touch,
	className,
}: AgendaDensityControlProps) {
	const group = useId();
	return (
		<fieldset className={cn("inline-flex items-center gap-0.5", className)}>
			<legend className="sr-only">Agenda density</legend>
			{DENSITY_OPTIONS.map((option) => (
				<label
					key={option.value}
					aria-label={option.label}
					className={cn(
						segmentClassName(value === option.value),
						touch ? "min-h-11 flex-1 text-sm" : "h-7 text-xs",
					)}
				>
					<input
						type="radio"
						name={group}
						value={option.value}
						checked={value === option.value}
						onChange={() => onChange(option.value)}
						className="sr-only"
					/>
					{icons ? <option.Icon className="size-4" /> : option.label}
				</label>
			))}
		</fieldset>
	);
}

/* ------------------------------------------------------------------ */
/* What's next                                                         */
/* ------------------------------------------------------------------ */

export interface NextUpCardProps {
	nextUp: NextUp;
	/** Whose hue each named event is drawn with. */
	calendars: readonly CalendarDescriptor[];
	today: string;
	onSelectEvent: (eventId: string) => void;
	onGoTo: (date: string) => void;
	touch?: boolean;
	className?: string;
}

/**
 * The one question a grid answers badly. "What is next" out of a time grid
 * means finding the now-line and reading downward past the empty rows; here it
 * is a sentence, and the free time after it is part of the same sentence.
 */
export function NextUpCard({
	nextUp,
	calendars,
	today,
	onSelectEvent,
	onGoTo,
	touch,
	className,
}: NextUpCardProps) {
	const { running, next, minutesUntilNext, after, free } = nextUp;
	const colorOf = useMemo(() => {
		const byId = new Map(
			calendars.map((calendar) => [calendar.id, calendar.color]),
		);
		return (calendarId: string): CalendarColorId =>
			byId.get(calendarId) ?? "cal-1";
	}, [calendars]);

	return (
		<section
			className={cn(
				"flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-3",
				className,
			)}
		>
			{running.length > 0 && (
				<div className="flex flex-col gap-1">
					<Caption icon={<Radio className="size-3 text-danger" />}>Now</Caption>
					{running.map((event) => (
						<EventButton
							key={event.id}
							eventId={event.id}
							title={event.title}
							color={colorOf(event.calendarId)}
							meta={`until ${event.end.slice(11, 16)}`}
							onSelect={onSelectEvent}
							touch={touch}
						/>
					))}
				</div>
			)}

			<div className="flex flex-col gap-1">
				<Caption icon={<Clock className="size-3" />}>
					{next ? `Next · in ${formatSpan(minutesUntilNext)}` : "Next"}
				</Caption>
				{next ? (
					<EventButton
						eventId={next.id}
						title={next.title}
						color={colorOf(next.calendarId)}
						meta={`${dayPrefix(next.start.slice(0, 10), today)}${next.start.slice(
							11,
							16,
						)}${next.location === "" ? "" : ` · ${next.location}`}`}
						onSelect={onSelectEvent}
						touch={touch}
					/>
				) : (
					<p className="text-sm text-fg-muted">Nothing else booked.</p>
				)}
				{after && (
					<p className="truncate pl-1 text-2xs text-fg-subtle">
						then {after.title} · {dayPrefix(after.start.slice(0, 10), today)}
						{after.start.slice(11, 16)}
					</p>
				)}
			</div>

			{free && (
				<button
					type="button"
					onClick={() => onGoTo(free.date)}
					className={cn(
						"flex items-center gap-2 rounded-md border border-dashed border-accent-2 bg-accent-2-soft/40 px-2 text-left text-accent-2 outline-none transition-colors hover:bg-accent-2-soft focus-visible:ring-2 focus-visible:ring-ring",
						touch ? "min-h-11" : "min-h-8",
					)}
				>
					<Sun className="size-3.5 shrink-0" />
					<span className="text-xs font-medium">
						{formatSpan(free.minutes)} free
					</span>
					<span className="text-2xs tabular-nums opacity-80">
						{dayPrefix(free.date, today)}
						{formatMinute(free.startMinute)} – {formatMinute(free.endMinute)}
					</span>
				</button>
			)}
		</section>
	);
}

function Caption({ icon, children }: { icon: ReactNode; children: ReactNode }) {
	return (
		<h3 className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
			{icon}
			{children}
		</h3>
	);
}

function EventButton({
	eventId,
	title,
	color,
	meta,
	onSelect,
	touch,
}: {
	eventId: string;
	title: string;
	color: CalendarColorId;
	meta: string;
	onSelect: (eventId: string) => void;
	touch?: boolean;
}) {
	const hue = calendarColorClasses(color);
	return (
		<button
			type="button"
			onClick={() => onSelect(eventId)}
			className={cn(
				"flex w-full items-center gap-2 rounded-md border-l-2 px-2 py-1 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
				hue.soft,
				hue.text,
				hue.rail,
				touch && "min-h-12",
			)}
		>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm font-medium">{title}</span>
				<span className="block truncate text-2xs opacity-80">{meta}</span>
			</span>
		</button>
	);
}

function dayPrefix(date: string, today: string): string {
	if (date === today) return "";
	if (date === addDays(today, 1)) return "tomorrow · ";
	return `${formatShortDay(date)} · `;
}

/* ------------------------------------------------------------------ */
/* Free time                                                           */
/* ------------------------------------------------------------------ */

export interface FreeTimeListProps {
	stretches: FreeStretch[];
	today: string;
	onPick: (stretch: FreeStretch) => void;
	touch?: boolean;
}

/** Empty time, listed like anything else that is on the calendar. */
export function FreeTimeList({
	stretches,
	today,
	onPick,
	touch,
}: FreeTimeListProps) {
	return (
		<section className="flex flex-col gap-1.5">
			<Caption icon={<CalendarOff className="size-3" />}>Open time</Caption>
			{stretches.length === 0 ? (
				<p className="text-xs text-fg-subtle">
					Nothing open in the days on screen.
				</p>
			) : (
				stretches.map((stretch) => (
					<button
						key={`${stretch.date}_${stretch.startMinute}`}
						type="button"
						onClick={() => onPick(stretch)}
						className={cn(
							"flex items-center gap-2 rounded-md border border-line px-2 text-left outline-none transition-colors hover:border-accent hover:text-accent focus-visible:ring-2 focus-visible:ring-ring",
							touch ? "min-h-11" : "min-h-8",
						)}
					>
						<span className="text-xs font-medium text-fg">
							{formatSpan(stretch.minutes)}
						</span>
						<span className="min-w-0 flex-1 truncate text-2xs text-fg-subtle">
							{stretch.date === today ? "today" : formatShortDay(stretch.date)}{" "}
							· {formatMinute(stretch.startMinute)} –{" "}
							{formatMinute(stretch.endMinute)}
						</span>
					</button>
				))
			)}
		</section>
	);
}

/* ------------------------------------------------------------------ */
/* Where you are in the strip                                          */
/* ------------------------------------------------------------------ */

export interface PositionMapProps {
	/** The month to draw, and the one after it. */
	anchorDate: string;
	visibleDate: string;
	today: string;
	dayOf: (date: string) => CalendarDay;
	onGoTo: (date: string) => void;
	className?: string;
}

/**
 * Two months as a heat strip: how full each day is, and where the strip is
 * currently parked. It is a scrollbar with meaning — the empty days are as
 * legible as the full ones, which is the whole argument in miniature.
 */
export function PositionMap({
	anchorDate,
	visibleDate,
	today,
	dayOf,
	onGoTo,
	className,
}: PositionMapProps) {
	const months = [
		monthStart(anchorDate),
		monthStart(addDays(monthEnd(anchorDate), 1)),
	];
	const span = DAY_END_MINUTE - DAY_START_MINUTE;

	return (
		<div className={cn("flex flex-col gap-3", className)}>
			{months.map((first) => (
				<section key={first} className="flex flex-col gap-1">
					<h3 className="px-row-inset text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
						{shortMonthLabel(first)}
					</h3>
					<div className="grid grid-cols-7 gap-0.5 px-row-inset">
						{leadingBlanks(first).map((key) => (
							<span key={key} />
						))}
						{datesBetween(first, monthEnd(first)).map((date) => {
							const day = dayOf(date);
							const fill = Math.min(1, day.busyMinutes / span);
							return (
								<button
									key={date}
									type="button"
									onClick={() => onGoTo(date)}
									className={cn(
										"relative flex h-6 items-center justify-center rounded-sm text-2xs tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
										date === visibleDate
											? "bg-surface-raised font-semibold text-fg ring-1 ring-line-strong"
											: "text-fg-muted hover:bg-surface-sunken",
										date === today && "font-semibold text-accent",
									)}
								>
									{Number(date.slice(8))}
									{fill > 0 && (
										<span
											aria-hidden
											className="absolute inset-x-1 bottom-0.5 h-0.5 rounded-full bg-fg-subtle"
											style={{ opacity: 0.35 + fill * 0.65 }}
										/>
									)}
									{day.conflicts.length > 0 && (
										<span
											aria-hidden
											className="absolute right-0.5 top-0.5 size-1 rounded-full bg-warning"
										/>
									)}
								</button>
							);
						})}
					</div>
				</section>
			))}
		</div>
	);
}

function monthStart(date: string): string {
	return `${date.slice(0, 8)}01`;
}

function monthEnd(date: string): string {
	const [year, month] = date.split("-").map(Number);
	const last = new Date(Date.UTC(year, month, 0));
	return last.toISOString().slice(0, 10);
}

/** Monday-first padding cells before the first of the month. */
function leadingBlanks(first: string): string[] {
	const [year, month, day] = first.split("-").map(Number);
	const weekday = new Date(year, month - 1, day).getDay();
	const count = (weekday + 6) % 7;
	return Array.from({ length: count }, (_, index) => `blank_${first}_${index}`);
}
