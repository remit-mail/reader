import { Globe, Mail, Repeat } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import type { RsvpState, ZoneCertainty } from "./calendar-types.js";

export interface CalendarEventChipContentProps {
	title: string;
	/** Rendered ahead of the title; empty for an all-day entry. */
	timeText: string;
	/**
	 * `row` is the horizontal pill of the all-day band and the month grid.
	 * `column` is the block that fills its slot in a time grid.
	 */
	layout: "row" | "column";
	rsvp: RsvpState;
	/** Carries the mail mark that says this event has a thread behind it. */
	hasThread: boolean;
	isRecurring: boolean;
	zoneCertainty: ZoneCertainty;
	/** Rendered at the far end of the title line — a length, a count. */
	trailing?: ReactNode;
	/** A second line under the title: where it is, who is coming, whose calendar. */
	detail?: ReactNode;
}

/**
 * What is written inside one event: the time, the title, the marks, and
 * whatever the surface adds beside them. Every surface that draws an event
 * draws this — `CalendarEventChip` inside its own button, `CalendarGrid` inside
 * the element its engine built — so an event reads the same wherever it lands.
 */
export function CalendarEventChipContent({
	title,
	timeText,
	layout,
	rsvp,
	hasThread,
	isRecurring,
	zoneCertainty,
	trailing,
	detail,
}: CalendarEventChipContentProps) {
	const isColumn = layout === "column";
	const zoneAmbiguous = zoneCertainty === "ambiguous";
	const stacked = !isColumn && detail !== undefined;

	const head = (
		<span
			className={cn(
				"flex min-w-0 items-center gap-1",
				isColumn && "w-full",
				rsvp === "declined" && "line-through",
			)}
		>
			{timeText !== "" && (
				<span className="shrink-0 tabular-nums opacity-80">{timeText}</span>
			)}
			<span className="truncate font-medium">{title}</span>
		</span>
	);

	const marks = (isRecurring || hasThread || zoneAmbiguous) && (
		<span
			className={cn(
				"flex shrink-0 items-center gap-1",
				isColumn && "mt-0.5",
				!isColumn && trailing === undefined && "ml-auto",
			)}
		>
			{isRecurring && <Repeat className="size-2.5" aria-label="Repeats" />}
			{hasThread && <Mail className="size-2.5" aria-label="From mail" />}
			{zoneAmbiguous && (
				<Globe className="size-2.5 text-warning" aria-label="Unclear zone" />
			)}
		</span>
	);

	const tail = trailing !== undefined && (
		<span className={cn("shrink-0 opacity-80", !isColumn && "ml-auto")}>
			{trailing}
		</span>
	);

	return (
		<>
			{stacked ? (
				<span className="flex min-w-0 items-center gap-1.5">
					{head}
					{marks}
					{tail}
				</span>
			) : (
				<>
					{head}
					{marks}
					{tail}
				</>
			)}
			{detail}
		</>
	);
}
