import type { DOMAttributes } from "@react-types/shared";
import { useLongPress as useAriaLongPress } from "react-aria";

export interface UseLongPressOptions {
	/** Called once the threshold elapses while the press stays over the target. */
	onLongPress: () => void;
	/** Long press is a no-op while true (e.g. a row already in selection mode). */
	isDisabled?: boolean;
	/** @default 500 */
	delayMs?: number;
	/**
	 * Announced to assistive technology as the long-press action, e.g.
	 * "Select message". TalkBack/VoiceOver have no gesture equivalent for a
	 * timed hold, so this description — not the gesture itself — is what
	 * makes the action discoverable to a screen reader user.
	 */
	accessibilityDescription?: string;
}

export interface UseLongPressResult {
	/** Spread onto the pressable element (anchor, button, or row container). */
	longPressProps: DOMAttributes;
}

/**
 * Long-press detection backed by react-aria's `useLongPress`. Owns
 * `contextmenu` suppression and iOS text-selection suppression, and treats
 * `<a href>` targets specially so link navigation and middle-click survive
 * outside the press. It does not, and cannot, suppress iOS's native callout
 * (share sheet) on an anchor — that still requires
 * `-webkit-touch-callout: none` in CSS at the call site, since iOS fires no
 * cancelable event for it.
 *
 * Single source of truth for the app's long-press threshold — both mobile
 * row consumers (the plain row and the swipeable row) go through this hook
 * so their timing can't drift apart again.
 */
export function useLongPress({
	onLongPress,
	isDisabled,
	delayMs = 500,
	accessibilityDescription,
}: UseLongPressOptions): UseLongPressResult {
	return useAriaLongPress({
		isDisabled,
		threshold: delayMs,
		accessibilityDescription,
		onLongPress,
	});
}
