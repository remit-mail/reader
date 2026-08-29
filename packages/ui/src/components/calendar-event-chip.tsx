import type { ReactNode } from "react";
import { calendarEventBodyClasses } from "../lib/calendar-event-shell.js";
import { cn } from "../lib/cn.js";
import type { Density } from "./app-shell-types.js";
import { CalendarEventChipContent } from "./calendar-event-chip-content.js";
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
 * `CalendarGrid` is the one surface that does not render this component — its
 * engine builds the event's element itself. It draws the same event out of the
 * same two pieces: `calendarEventBodyClasses` for the box and
 * `CalendarEventChipContent` for what is written in it. What cannot cross is
 * the element, and with it `aria-pressed` and the leading slot.
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
	const isColumn = layout === "column";

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
			<span
				className={cn(
					calendarEventBodyClasses({
						color,
						layout,
						density,
						rsvp,
						status,
						selected,
						stacked: detail !== undefined,
					}),
					"flex-1",
					isColumn && "h-full",
				)}
			>
				<CalendarEventChipContent
					title={title}
					timeText={timeText}
					layout={layout}
					rsvp={rsvp}
					hasThread={hasThread}
					isRecurring={isRecurring}
					zoneCertainty={zoneCertainty}
					trailing={trailing}
					detail={detail}
				/>
			</span>
		</button>
	);
}
