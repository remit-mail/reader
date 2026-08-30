import { type CalendarSlotPick, calendarColorClasses, cn } from "@remit/ui";
import {
	type BusyBlock,
	DAY_END,
	DAY_START,
	type SoftHold,
	toMinutes,
} from "../../fixtures/calendar-mail.js";

/**
 * One day's commitments, drawn beside the mail that is asking for a slot of it.
 * It is deliberately not the calendar grid: there is nothing to create here and
 * nothing to drag. It answers one question — what is already true about this
 * day — and it answers it without leaving the thread.
 */

const WINDOW_START = toMinutes(DAY_START);
const WINDOW_END = toMinutes(DAY_END);
const WINDOW = WINDOW_END - WINDOW_START;

/** A time named in the mail, drawn against what is already booked. */
export interface AvailabilityMark {
	id: string;
	startTime: string;
	endTime: string;
	tone: "clash" | "free" | "proposed";
	label: string;
}

const markTone: Record<AvailabilityMark["tone"], string> = {
	clash: "border-danger",
	free: "border-positive",
	proposed: "border-accent-2 border-dashed",
};

const markLabelTone: Record<AvailabilityMark["tone"], string> = {
	clash: "text-danger",
	free: "text-positive",
	proposed: "text-accent-2",
};

export interface AvailabilityStripProps {
	blocks: BusyBlock[];
	holds?: SoftHold[];
	marks?: AvailabilityMark[];
	/** Slots the reader has ticked but not sent yet. */
	picked?: CalendarSlotPick[];
	/** Pixels per minute; the caller sizes the strip to the room it has. */
	minuteHeight?: number;
	onSelectBlock?: (eventId: string) => void;
	className?: string;
}

function offsetOf(clock: string): number {
	return toMinutes(clock) - WINDOW_START;
}

export function AvailabilityStrip({
	blocks,
	holds = [],
	marks = [],
	picked = [],
	minuteHeight = 0.62,
	onSelectBlock,
	className,
}: AvailabilityStripProps) {
	const height = WINDOW * minuteHeight;
	const hours: number[] = [];
	for (let hour = WINDOW_START / 60; hour <= WINDOW_END / 60; hour += 1)
		hours.push(hour);

	return (
		<div className={cn("flex w-full gap-2", className)} style={{ height }}>
			<div className="relative w-7 shrink-0">
				{hours
					.filter((hour) => hour % 2 === 0)
					.map((hour) => (
						<span
							key={hour}
							className="absolute right-0 -translate-y-1/2 text-2xs tabular-nums text-fg-subtle"
							style={{ top: (hour * 60 - WINDOW_START) * minuteHeight }}
						>
							{String(hour).padStart(2, "0")}
						</span>
					))}
			</div>

			<div className="relative min-w-0 flex-1 rounded-md border border-line bg-surface">
				{hours.map((hour) => (
					<span
						key={hour}
						className={cn(
							"absolute inset-x-0 border-t",
							hour % 2 === 0 ? "border-line" : "border-line/60 border-dashed",
						)}
						style={{ top: (hour * 60 - WINDOW_START) * minuteHeight }}
					/>
				))}

				{blocks.map((block) => {
					const hue = calendarColorClasses(block.color);
					const top = offsetOf(block.start) * minuteHeight;
					const size =
						(toMinutes(block.end) - toMinutes(block.start)) * minuteHeight;
					return (
						<button
							key={block.eventId}
							type="button"
							disabled={!onSelectBlock}
							onClick={() => onSelectBlock?.(block.eventId)}
							title={`${block.label} · ${block.title} · ${block.calendarName}`}
							className={cn(
								"absolute overflow-hidden rounded-xs border-l-2 px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
								hue.soft,
								hue.text,
								hue.rail,
								block.declined && "opacity-45 line-through",
							)}
							style={{
								top,
								height: Math.max(size, 8),
								left: `${(block.lane / block.lanes) * 100}%`,
								width: `${(1 / block.lanes) * 100 - 1}%`,
							}}
						>
							<span className="block truncate text-2xs font-medium leading-tight">
								{block.title}
							</span>
							{size > 26 && (
								<span className="block truncate text-2xs leading-tight opacity-75">
									{block.label}
								</span>
							)}
						</button>
					);
				})}

				{picked.map((slot) => (
					<div
						key={`pick-${slot.startTime}`}
						className="absolute inset-x-0 rounded-xs border border-dashed border-accent bg-accent-soft"
						style={{
							top: offsetOf(slot.startTime) * minuteHeight,
							height: Math.max(
								(toMinutes(slot.endTime) - toMinutes(slot.startTime)) *
									minuteHeight,
								8,
							),
						}}
					>
						<span className="block truncate px-1 text-2xs font-medium leading-tight text-accent">
							Offering {slot.startTime}
						</span>
					</div>
				))}

				{holds.map((hold) => (
					<div
						key={hold.id}
						className="absolute inset-x-0 rounded-xs border border-dashed border-accent-2 bg-accent-2-soft"
						style={{
							top: offsetOf(hold.startTime) * minuteHeight,
							height: Math.max(
								(toMinutes(hold.endTime) - toMinutes(hold.startTime)) *
									minuteHeight,
								8,
							),
						}}
					>
						<span className="block truncate px-1 text-2xs font-medium leading-tight text-accent-2">
							Hold · {hold.startTime}
						</span>
					</div>
				))}

				{marks.map((mark) => (
					<div
						key={mark.id}
						className={cn(
							"pointer-events-none absolute -inset-x-1 rounded-sm border-2",
							markTone[mark.tone],
						)}
						style={{
							top: offsetOf(mark.startTime) * minuteHeight,
							height: Math.max(
								(toMinutes(mark.endTime) - toMinutes(mark.startTime)) *
									minuteHeight,
								10,
							),
						}}
					>
						<span
							className={cn(
								"absolute -top-2 right-1 rounded-xs bg-surface px-1 text-2xs font-semibold",
								markLabelTone[mark.tone],
							)}
						>
							{mark.label}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}
