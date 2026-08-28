import { Globe, Mail, Repeat } from "lucide-react";
import type { ReactNode } from "react";
import { calendarColorClasses } from "../lib/calendar-color.js";
import { cn } from "../lib/cn.js";
import type { Density } from "./app-shell-types.js";
import type {
	CalendarColorId,
	RsvpState,
	ZoneCertainty,
} from "./calendar-types.js";

export interface CalendarEventChipProps {
	title: string;
	/** Rendered ahead of the title; empty for an all-day entry. */
	timeText: string;
	color: CalendarColorId;
	/**
	 * `row` is the horizontal pill of the all-day band and the month grid.
	 * `column` is the block that fills its slot in a time grid.
	 */
	layout: "row" | "column";
	density: Density;
	rsvp: RsvpState;
	status: "confirmed" | "tentative";
	/** Carries the mail mark that says this event has a thread behind it. */
	hasThread: boolean;
	isRecurring: boolean;
	zoneCertainty: ZoneCertainty;
	selected: boolean;
	onClick?: () => void;
	/**
	 * Rendered inside the control but outside the coloured body, ahead of it —
	 * the agenda's time gutter, which has to line up down a whole day and so
	 * cannot sit inside a block whose width follows the title.
	 */
	leading?: ReactNode;
	/** Rendered at the far end of the title line — a length, a count. */
	trailing?: ReactNode;
	/** A second line under the title: where it is, who is coming, whose calendar. */
	detail?: ReactNode;
}

/**
 * One event, wherever an event is ours to render: the agenda, a day column of
 * our own, a picker, the phone list. The calendar's hue is the only colour it
 * carries; the RSVP and the zone ride on shape and mark instead, so a declined
 * event in a green calendar still reads as green and as declined.
 *
 * A FullCalendar grid is the one surface that does not use it — the library
 * renders the event's element itself and takes only a class string and the
 * content inside, so `calendar-grid.tsx` restates this shell there. Every value
 * that can be shared is the same on both sides; what cannot cross is the
 * element itself, and with it `aria-pressed` and the focus ring.
 */
export function CalendarEventChip({
	title,
	timeText,
	color,
	layout,
	density,
	rsvp,
	status,
	hasThread,
	isRecurring,
	zoneCertainty,
	selected,
	onClick,
	leading,
	trailing,
	detail,
}: CalendarEventChipProps) {
	const hue = calendarColorClasses(color);
	const isColumn = layout === "column";
	const isCompact = density === "compact";
	const declined = rsvp === "declined";
	const provisional = rsvp === "tentative" || status === "tentative";
	const stacked = isColumn || detail !== undefined;

	const head = (
		<span
			className={cn(
				"flex min-w-0 items-center gap-1",
				isColumn && "w-full",
				declined && "line-through",
			)}
		>
			{timeText !== "" && (
				<span className="shrink-0 tabular-nums opacity-80">{timeText}</span>
			)}
			<span className="truncate font-medium">{title}</span>
		</span>
	);

	const marks = (hasThread || isRecurring || zoneCertainty === "ambiguous") && (
		<span
			className={cn(
				"flex shrink-0 items-center gap-1",
				isColumn && "mt-0.5",
				!isColumn && trailing === undefined && "ml-auto",
			)}
		>
			{isRecurring && <Repeat className="size-2.5" aria-label="Repeats" />}
			{hasThread && <Mail className="size-2.5" aria-label="From mail" />}
			{zoneCertainty === "ambiguous" && (
				<Globe className="size-2.5 text-warning" aria-label="Unclear zone" />
			)}
		</span>
	);

	const tail = trailing !== undefined && (
		<span className={cn("shrink-0 opacity-80", !isColumn && "ml-auto")}>
			{trailing}
		</span>
	);

	const body = (
		<span
			className={cn(
				"flex min-w-0 flex-1 overflow-hidden rounded-sm border-l-2 px-1.5 py-0.5",
				hue.soft,
				hue.text,
				hue.rail,
				isColumn && "h-full",
				stacked ? "flex-col" : "items-center gap-1.5",
				provisional && "border-y border-r border-dashed",
				provisional && hue.border,
				declined && "opacity-60",
				selected && "ring-2 ring-ring",
				isCompact ? "text-2xs" : "text-xs",
			)}
		>
			{isColumn || detail === undefined ? (
				<>
					{head}
					{marks}
					{tail}
				</>
			) : (
				<span className="flex min-w-0 items-center gap-1.5">
					{head}
					{marks}
					{tail}
				</span>
			)}
			{detail}
		</span>
	);

	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={selected}
			className={cn(
				"group flex w-full min-w-0 text-left outline-none transition-colors",
				"focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
				isColumn ? "h-full" : "items-start",
				leading !== undefined && "gap-2",
			)}
		>
			{leading}
			{body}
		</button>
	);
}
