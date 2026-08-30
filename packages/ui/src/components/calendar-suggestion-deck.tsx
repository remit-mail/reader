import { Sparkles } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "../lib/cn.js";

/**
 * Readings one at a time, as a deck rather than a column: one decision fills
 * the width it is given, and the swipe is the fast path over the buttons that
 * are always there under it. A gesture is never the only way to answer.
 */

const COMMIT_DISTANCE = 96;

export interface CalendarSuggestionDeckProps {
	children: ReactNode;
	/** False when the deck has nothing left. */
	hasCard: boolean;
	onConfirm: () => void;
	onReject: () => void;
	/** True while the top card cannot be confirmed — an unsettled clock. */
	blocked: boolean;
	blockedReason: string;
	remaining: number;
	/** What the swipe badge says in the confirming direction. */
	confirmLabel?: string;
	/** What an empty deck says. */
	emptyText?: string;
	className?: string;
}

export function CalendarSuggestionDeck({
	children,
	hasCard,
	onConfirm,
	onReject,
	blocked,
	blockedReason,
	remaining,
	confirmLabel = "Add",
	emptyText = "Nothing in your mail is waiting on a decision about time.",
	className,
}: CalendarSuggestionDeckProps) {
	const [drag, setDrag] = useState(0);
	const [from, setFrom] = useState<number | null>(null);

	if (!hasCard)
		return (
			<div
				className={cn(
					"flex flex-col items-center gap-2 p-6 text-center",
					className,
				)}
			>
				<Sparkles className="size-6 text-fg-subtle" aria-hidden />
				<p className="text-sm text-fg-muted">{emptyText}</p>
			</div>
		);

	const committing = Math.abs(drag) > COMMIT_DISTANCE;
	const towardsConfirm = drag > 0;

	return (
		<div className={cn("flex flex-col gap-3", className)}>
			<div className="relative">
				<div
					className="touch-pan-y select-none"
					style={{
						transform: `translateX(${drag}px) rotate(${drag / 40}deg)`,
						transition: from === null ? "transform 180ms ease-out" : "none",
					}}
					onPointerDown={(e) => {
						e.currentTarget.setPointerCapture(e.pointerId);
						setFrom(e.clientX);
					}}
					onPointerMove={(e) => {
						if (from === null) return;
						setDrag(e.clientX - from);
					}}
					onPointerUp={() => {
						if (Math.abs(drag) > COMMIT_DISTANCE) {
							if (drag > 0 && !blocked) onConfirm();
							if (drag < 0) onReject();
						}
						setFrom(null);
						setDrag(0);
					}}
					onPointerCancel={() => {
						setFrom(null);
						setDrag(0);
					}}
				>
					{children}
				</div>
				{committing && (
					<span
						className={cn(
							"pointer-events-none absolute top-3 rounded-md px-2 py-1 text-xs font-semibold",
							towardsConfirm
								? "right-3 bg-accent-soft text-accent"
								: "left-3 bg-danger-soft text-danger",
						)}
					>
						{towardsConfirm
							? blocked
								? blockedReason
								: confirmLabel
							: "Not this"}
					</span>
				)}
			</div>
			<p className="text-center text-2xs text-fg-subtle">
				{remaining} left · swipe right to accept, left to drop, or use the
				buttons
			</p>
		</div>
	);
}
