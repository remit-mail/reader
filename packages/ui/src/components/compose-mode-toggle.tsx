import { cn } from "../lib/cn.js";
import { Button } from "./button.js";

export type ComposeBodyMode = "rich" | "plain";

export interface ComposeModeToggleProps {
	mode: ComposeBodyMode;
	onToggle: () => void;
}

/**
 * A text button, not an icon. The two glyphs a reader would reach for are
 * already spoken for in an editor toolbar — the eraser clears formatting on a
 * selection and the `A` opens formatting options — and the label reads the same
 * in both states, so the control never changes under the finger.
 */
export const ComposeModeToggle = ({
	mode,
	onToggle,
}: ComposeModeToggleProps) => (
	<Button
		variant="ghost"
		size="md"
		aria-pressed={mode === "plain"}
		title="Plain text"
		onClick={onToggle}
		data-testid="compose-mode-toggle"
		className={cn(
			"min-h-11 shrink-0",
			mode === "plain" && "bg-accent-2-soft text-accent-2",
		)}
	>
		Plain text
	</Button>
);
