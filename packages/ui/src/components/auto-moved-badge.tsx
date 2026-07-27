import { Undo2 } from "lucide-react";
import { cn } from "../lib/cn.js";
import { Badge } from "./badge.js";

export interface AutoMovedBadgeProps {
	/** Plain-language description, e.g. "Moved from Junk by Remit". */
	label: string;
	/**
	 * Present only when undo is available for this message. Omit to render the
	 * indicator without an action (e.g. the target folder can't be resolved).
	 */
	onUndo?: () => void;
	undoLabel?: string;
	/**
	 * Settings › Filters link, present only for a standing-filter move: undo
	 * returns the message but never disables the filter, so the badge offers a
	 * way to reach the filter that keeps moving mail. Omit for a classifier move.
	 */
	filtersHref?: string;
	manageLabel?: string;
	className?: string;
}

/**
 * Indicator that Remit auto-moved this message, with an optional inline
 * one-click undo and, for a standing-filter move, a link to the filter in
 * Settings. Sized for a message header, not a list row. Purely presentational —
 * the label text, whether the move is still in effect (so the badge should
 * render at all), and whether a filter link applies are the caller's
 * responsibility; this component has no notion of placement/mailbox state.
 */
export function AutoMovedBadge({
	label,
	onUndo,
	undoLabel = "Undo",
	filtersHref,
	manageLabel = "Manage filter",
	className,
}: AutoMovedBadgeProps) {
	return (
		<Badge tone="accent" className={cn("py-1 text-xs", className)}>
			<Undo2 className="size-3.5 shrink-0" aria-hidden />
			<span>{label}</span>
			{onUndo && (
				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						onUndo();
					}}
					className="font-semibold underline decoration-dotted underline-offset-2 hover:decoration-solid"
				>
					{undoLabel}
				</button>
			)}
			{filtersHref && (
				<a
					href={filtersHref}
					onClick={(event) => {
						event.stopPropagation();
					}}
					className="font-semibold underline decoration-dotted underline-offset-2 hover:decoration-solid"
				>
					{manageLabel}
				</a>
			)}
		</Badge>
	);
}
