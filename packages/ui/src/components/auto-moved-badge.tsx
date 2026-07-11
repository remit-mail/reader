import { Undo2 } from "lucide-react";
import { cn } from "../lib/cn.js";
import { Badge } from "./badge.js";

export interface AutoMovedBadgeProps {
	/** Plain-language description, e.g. "Moved from Junk by Remit". */
	label: string;
	/** `md` adds an inline Undo action for the open-message header; `sm` (list row) is icon + label only. */
	size?: "sm" | "md";
	/**
	 * Present only when undo is available for this message. Omit to render the
	 * indicator without an action (e.g. the target folder can't be resolved).
	 */
	onUndo?: () => void;
	undoLabel?: string;
	className?: string;
}

/**
 * Unobtrusive indicator that Remit auto-moved this message, with an optional
 * inline one-click undo. Purely presentational — the label text and whether
 * the move is still in effect (so the badge should render at all) are the
 * caller's responsibility; this component has no notion of placement/mailbox
 * state.
 */
export function AutoMovedBadge({
	label,
	size = "sm",
	onUndo,
	undoLabel = "Undo",
	className,
}: AutoMovedBadgeProps) {
	return (
		<Badge
			tone="accent"
			className={cn(size === "md" && "py-1 text-xs", className)}
		>
			<Undo2
				className={cn(size === "sm" ? "size-3" : "size-3.5", "shrink-0")}
				aria-hidden
			/>
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
		</Badge>
	);
}
