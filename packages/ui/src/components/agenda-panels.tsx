import { Clock, Radio, Sun } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import {
	addDays,
	formatMinute,
	formatShortDay,
	formatSpan,
	type NextUp,
} from "../lib/agenda-time.js";
import { calendarColorClasses } from "../lib/calendar-color.js";
import { cn } from "../lib/cn.js";
import type { CalendarColorId, CalendarDescriptor } from "./calendar-types.js";

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
