import {
	AlertTriangle,
	Globe,
	Mail,
	Plus,
	SlidersHorizontal,
	X,
} from "lucide-react";
import { useId, useState } from "react";
import { cn } from "../lib/cn.js";
import { BlockedReason } from "./blocked-reason.js";
import { Button } from "./button.js";
import type { EventSuggestion } from "./calendar-types.js";

export const ZONE_UNSETTLED_REASON =
	"Pick a clock first. The mail never said, and the reader will not choose for you.";

/**
 * Which zone the suggestion would be booked on. `timeZone` is empty when the
 * source said it itself and the reader settled nothing.
 */
export type ZoneSettlement =
	| { settled: true; timeZone: string }
	| { settled: false; reason: string };

/**
 * A time nobody stated a zone for is an hour nobody stated. The choice has to
 * come from the reader and it has to be one of the clocks offered — a stale or
 * unrecognised choice leaves the suggestion unsettled rather than guessing, and
 * nothing here reads the zone the browser happens to be in.
 */
export function settleZone(
	suggestion: EventSuggestion,
	zoneChoice: string,
): ZoneSettlement {
	const options = suggestion.zoneOptions;
	if (options === undefined) return { settled: true, timeZone: "" };
	if (options.some((option) => option.timeZone === zoneChoice))
		return { settled: true, timeZone: zoneChoice };
	return { settled: false, reason: ZONE_UNSETTLED_REASON };
}

export interface EventSuggestionCardProps {
	suggestion: EventSuggestion;
	/** Already formatted by the caller. */
	whenText: string;
	/** The zone the reader settled on, empty when the mail already knew. */
	onAdd: (timeZone: string) => void;
	onReview: () => void;
	onDismiss: () => void;
	onOpenThread: () => void;
	/** The clock picked so far. Omit to let the card hold the choice itself. */
	zoneChoice?: string;
	onZoneChoice?: (timeZone: string) => void;
	touch?: boolean;
	className?: string;
}

/** Words for a number, so the card never shows a false 87%. */
function confidenceText(confidence: number): string {
	if (confidence >= 0.85) return "Read cleanly";
	if (confidence >= 0.6) return "Read with gaps";
	return "Barely read";
}

/**
 * A candidate, and unmistakably not an event. It lives off the grid, on a
 * dashed card, and only a person pressing Add puts anything on the calendar —
 * a machine reading of a mail never becomes a provisional block that someone
 * has to notice and remove.
 *
 * Where the mail never said which clock a time is on, Add is dimmed until the
 * reader picks one and refuses the press until then: booking the wrong hour is
 * worse than asking.
 */
export function EventSuggestionCard({
	suggestion,
	whenText,
	onAdd,
	onReview,
	onDismiss,
	onOpenThread,
	zoneChoice,
	onZoneChoice,
	touch,
	className,
}: EventSuggestionCardProps) {
	const [ownChoice, setOwnChoice] = useState("");
	const [nudged, setNudged] = useState(false);
	const reasonId = useId();
	const choice = zoneChoice ?? ownChoice;
	const pickZone = (timeZone: string) => {
		setNudged(false);
		if (onZoneChoice) onZoneChoice(timeZone);
		else setOwnChoice(timeZone);
	};
	const settlement = settleZone(suggestion, choice);

	return (
		<article
			aria-label={suggestion.title}
			className={cn(
				"flex flex-col gap-2 rounded-lg border border-dashed border-line-strong bg-surface-sunken p-3",
				className,
			)}
		>
			<div className="flex items-start gap-2">
				<span className="min-w-0 flex-1">
					<span className="block text-2xs uppercase tracking-wider text-fg-subtle">
						Suggested from mail · {confidenceText(suggestion.confidence)}
					</span>
					<span className="block truncate text-sm font-medium text-fg">
						{suggestion.title}
					</span>
					<span className="block text-xs text-fg-muted">{whenText}</span>
					{suggestion.location !== "" && (
						<span className="block truncate text-xs text-fg-muted">
							{suggestion.location}
						</span>
					)}
				</span>
				<button
					type="button"
					aria-label="Dismiss suggestion"
					onClick={onDismiss}
					className={cn(
						"flex shrink-0 items-center justify-center rounded-md text-fg-subtle outline-none hover:bg-surface hover:text-fg focus-visible:ring-2 focus-visible:ring-ring",
						touch ? "size-11" : "size-7",
					)}
				>
					<X className="size-4" />
				</button>
			</div>

			{suggestion.ambiguity !== "" && (
				<p className="flex items-start gap-1.5 text-2xs text-warning">
					<AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
					{suggestion.ambiguity}
				</p>
			)}

			<button
				type="button"
				onClick={onOpenThread}
				className="flex w-full min-w-0 items-center gap-1.5 rounded-sm text-left text-2xs text-accent-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
			>
				<Mail className="size-3 shrink-0" />
				<span className="truncate">
					{suggestion.sender} — {suggestion.threadSubject}
				</span>
			</button>

			{suggestion.zoneOptions && (
				<div className="flex flex-col gap-1.5 rounded-md border border-warning/40 p-2">
					<p className="flex items-center gap-1.5 text-2xs font-semibold text-warning">
						<Globe className="size-3 shrink-0" aria-hidden />
						Which clock is this on?
					</p>
					{suggestion.zoneOptions.map((option) => (
						<button
							key={option.timeZone}
							type="button"
							aria-pressed={choice === option.timeZone}
							onClick={() => pickZone(option.timeZone)}
							className={cn(
								"rounded-md border px-2 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
								touch && "min-h-11",
								choice === option.timeZone
									? "border-accent bg-accent-soft"
									: "border-line bg-surface hover:border-line-strong",
							)}
						>
							<span className="block text-xs font-medium text-fg">
								{option.label}
							</span>
							<span className="block text-2xs text-fg-subtle">
								{option.note}
							</span>
						</button>
					))}
				</div>
			)}

			{!settlement.settled && (
				<BlockedReason
					id={reasonId}
					reason={settlement.reason}
					nudged={nudged}
					className="text-2xs text-warning"
				/>
			)}

			<div className="flex items-center gap-2">
				<Button
					variant="primary"
					size={touch ? "md" : "sm"}
					icon={<Plus className="size-3.5" />}
					onClick={() => {
						if (!settlement.settled) {
							setNudged(true);
							return;
						}
						onAdd(settlement.timeZone);
					}}
					aria-describedby={settlement.settled ? undefined : reasonId}
					className={cn(
						touch && "min-h-11 flex-1",
						!settlement.settled && "opacity-55",
					)}
				>
					Add
				</Button>
				<Button
					variant="secondary"
					size={touch ? "md" : "sm"}
					icon={<SlidersHorizontal className="size-3.5" />}
					onClick={onReview}
					className={touch ? "min-h-11" : ""}
				>
					Change first
				</Button>
			</div>
		</article>
	);
}
