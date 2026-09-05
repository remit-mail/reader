import { type RefObject, useEffect } from "react";

const FOCUSABLE_SELECTOR =
	'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Moves focus to the first focusable descendant of `ref` when `open` turns
 * true, so a dialog or sheet never leaves a keyboard user parked on whatever
 * was focused behind it.
 */
export function useInitialFocus(
	ref: RefObject<HTMLElement | null>,
	open: boolean,
): void {
	useEffect(() => {
		if (!open) return;
		const container = ref.current;
		if (!container) return;
		const focusable =
			container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
		focusable[0]?.focus();
	}, [open, ref]);
}
