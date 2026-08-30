import { cn } from "../lib/cn.js";
import type { CalendarSlotPick } from "./calendar-types.js";

/**
 * The free slots, as things you can hand to someone rather than read off a
 * grid. Picking one is not a booking: it goes into a reply as plain text, and
 * onto the calendar only as a hold that releases itself.
 */

export interface CalendarSlotOffersProps {
	slots: CalendarSlotPick[];
	/** Start clocks already ticked. */
	picked: ReadonlySet<string>;
	onToggle: (slot: CalendarSlotPick) => void;
	/** What to say when the day has nothing at this length. */
	emptyText?: string;
	touch?: boolean;
	/** Lays the chips out in a scrolling row rather than a wrapping block. */
	scroll?: boolean;
	className?: string;
}

export function CalendarSlotOffers({
	slots,
	picked,
	onToggle,
	emptyText = "Nothing free that day at this length.",
	touch,
	scroll,
	className,
}: CalendarSlotOffersProps) {
	if (slots.length === 0)
		return (
			<p className={cn("text-xs text-fg-muted", className)}>{emptyText}</p>
		);

	return (
		<div
			className={cn(
				"flex gap-2",
				scroll ? "overflow-x-auto pb-1" : "flex-wrap",
				className,
			)}
		>
			{slots.map((slot) => {
				const on = picked.has(slot.startTime);
				return (
					<button
						key={slot.startTime}
						type="button"
						aria-pressed={on}
						onClick={() => onToggle(slot)}
						className={cn(
							"shrink-0 rounded-md border px-2 text-xs tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
							touch ? "min-h-11 px-3" : "h-7",
							on
								? "border-accent bg-accent-soft font-semibold text-accent"
								: "border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg",
						)}
					>
						{slot.startTime} – {slot.endTime}
					</button>
				);
			})}
		</div>
	);
}
