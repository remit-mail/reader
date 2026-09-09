import type { Density } from "../components/app-shell-types.js";
import type {
	CalendarColorId,
	RsvpState,
} from "../components/calendar-types.js";
import { calendarColorClasses } from "./calendar-color.js";
import { cn } from "./cn.js";

export interface CalendarEventShell {
	color: CalendarColorId;
	/**
	 * `row` is the horizontal pill of the all-day band and the month grid.
	 * `column` is the block that fills its slot in a time grid.
	 */
	layout: "row" | "column";
	density: Density;
	/** The reader's own reply. A declined event dims; it never recolours. */
	rsvp: RsvpState;
	status: "confirmed" | "tentative";
	selected: boolean;
	/** Two lines rather than one: a title with something under it. */
	stacked: boolean;
}

/**
 * The coloured body of one event: the hue, the RSVP, the selection, and the box
 * they sit in.
 *
 * `CalendarEventChip` draws this body inside a button of its own.
 * `CalendarGrid` cannot — its engine builds the event's element and takes a
 * class string for it — so there the engine's element *is* the body, styled
 * from here. Neither surface restates the other.
 *
 * How the body is sized is left to the surface: the chip stretches it beside a
 * leading slot, and the grid's engine has already positioned it.
 */
export function calendarEventBodyClasses(shell: CalendarEventShell): string {
	const hue = calendarColorClasses(shell.color);
	const provisional =
		shell.rsvp === "tentative" || shell.status === "tentative";
	return cn(
		"flex min-w-0 overflow-hidden rounded-sm border-l-2 px-1.5 py-0.5",
		hue.soft,
		hue.text,
		hue.rail,
		shell.layout === "column" || shell.stacked
			? "flex-col"
			: "items-center gap-1.5",
		provisional && "border-y border-r border-dashed",
		provisional && hue.border,
		shell.rsvp === "declined" && "opacity-60",
		shell.selected && "ring-2 ring-ring",
		shell.density === "compact" ? "text-2xs" : "text-xs",
	);
}
