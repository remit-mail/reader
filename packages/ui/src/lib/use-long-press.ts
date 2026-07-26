import type { DOMAttributes } from "@react-types/shared";
import { type PointerEvent, useCallback, useRef } from "react";
import { mergeProps, useLongPress as useAriaLongPress } from "react-aria";

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
 * The `contextmenu` suppression is keyed to the active pointer's type, tracked
 * off `pointerdown` on the same element: a touch or pen press suppresses the
 * menu Android Chrome and iOS Safari raise on a long press over a link, while a
 * mouse right-click is left alone so the desktop context menu keeps working. It
 * does not delegate this to react-aria's own suppression — that listener is
 * transient (added on press start, scoped to the touched node, and torn down
 * shortly after pointerup), so a press ended early by the swipe gesture's axis
 * arbitration, or a menu raised over a descendant node, slips past it.
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
	const { longPressProps } = useAriaLongPress({
		isDisabled,
		threshold: delayMs,
		accessibilityDescription,
		onLongPress,
	});

	const pointerTypeRef = useRef<string>("");

	const onPointerDown = useCallback((event: PointerEvent) => {
		pointerTypeRef.current = event.pointerType;
	}, []);

	const onContextMenu = useCallback((event: { preventDefault: () => void }) => {
		if (
			pointerTypeRef.current === "touch" ||
			pointerTypeRef.current === "pen"
		) {
			event.preventDefault();
		}
	}, []);

	return {
		longPressProps: mergeProps(longPressProps, {
			onPointerDown,
			onContextMenu,
		}),
	};
}
