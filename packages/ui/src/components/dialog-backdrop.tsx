import { cn } from "../lib/cn.js";

export interface DialogBackdropProps {
	/** Names the dismissal to assistive technology, e.g. `"Close"`. */
	label: string;
	onDismiss: () => void;
	className?: string;
}

/**
 * The scrim behind a modal and the click-to-dismiss on it, in the shape
 * `BottomSheet` already uses: a real button rather than a click handler on a
 * div, out of the tab order because Escape and the dialog's own Close are the
 * keyboard's way out. It sits as a sibling of the dialog card, never its
 * ancestor, so a click on the card is not a click on the scrim and nothing has
 * to stop propagation to survive.
 */
export const DialogBackdrop = ({
	label,
	onDismiss,
	className,
}: DialogBackdropProps) => (
	<button
		type="button"
		aria-label={label}
		tabIndex={-1}
		onClick={onDismiss}
		className={cn("absolute inset-0 bg-canvas/80", className)}
	/>
);
