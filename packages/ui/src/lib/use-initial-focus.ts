import { type RefObject, useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
	'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Moves focus to the first focusable descendant of `ref` when `open` turns
 * true, so a dialog or sheet never leaves a keyboard user parked on whatever
 * was focused behind it, and gives it back to whatever held it before once
 * `open` turns false again — guarded, since the trigger can have left the DOM
 * while the dialog was up.
 */
export function useInitialFocus(
	ref: RefObject<HTMLElement | null>,
	open: boolean,
): void {
	const restoreTo = useRef<HTMLElement | null>(null);

	useEffect(() => {
		if (!open) {
			const previous = restoreTo.current;
			restoreTo.current = null;
			if (previous && document.contains(previous)) previous.focus();
			return;
		}
		restoreTo.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		const container = ref.current;
		if (!container) return;
		const focusable =
			container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
		focusable[0]?.focus();
	}, [open, ref]);
}
