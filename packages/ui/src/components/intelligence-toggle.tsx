import { Info } from "lucide-react";
import { cn } from "../lib/cn.js";
import { Button } from "./button.js";

export interface IntelligenceToggleProps {
	/** Whether the intelligence rail is currently open. */
	open?: boolean;
	/**
	 * Whether the toggle can act right now — a rail exists for this view, the
	 * width allows it, and a thread is open. When false the button still renders,
	 * greyed out (#52).
	 */
	enabled?: boolean;
	onToggle?: () => void;
	className?: string;
}

/**
 * The (i) intelligence-rail toggle in the reading-pane toolbar.
 *
 * The toolbar's control set is fixed: the toggle occupies the same slot on
 * every view and in every selection state, and reports that it cannot act by
 * being disabled rather than by vanishing (#52). A control that appears and
 * disappears moves its neighbours and leaves the user with nothing to learn
 * from; a greyed-out one stays where they last saw it.
 */
export function IntelligenceToggle({
	open = false,
	enabled = true,
	onToggle,
	className,
}: IntelligenceToggleProps) {
	return (
		<Button
			variant="ghost"
			size="sm"
			icon={<Info className="size-4" />}
			title={enabled ? "Intelligence" : "Open a message to see its details"}
			aria-label={
				open ? "Hide intelligence sidebar" : "Show intelligence sidebar"
			}
			aria-pressed={open}
			disabled={!enabled}
			onClick={onToggle}
			className={cn(open && "bg-accent-2-soft text-accent-2", className)}
		/>
	);
}
