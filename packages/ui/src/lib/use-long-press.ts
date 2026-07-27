import type { DOMAttributes } from "@react-types/shared";
import { type PointerEvent, useCallback } from "react";
import { mergeProps, useLongPress as useAriaLongPress } from "react-aria";

/**
 * Suppression lives on the document, not on the row.
 *
 * There is one pointer, and the element under it does not survive the press: a
 * long press on a mailbox row enters selection mode, which swaps the swipeable
 * row for the plain one *while the finger is still down*. A handler on the row
 * that armed the press is torn down with it, and Android Chrome then raises its
 * link menu over the selection the press just made. A capture-phase listener on
 * the document sees the menu whichever node ends up under the finger.
 *
 * Set while a touch or pen press is down. A press that never delivers its
 * `pointerup` — the browser took the gesture, the tab went to the background —
 * would leave suppression armed forever, so arming is bounded by this timer as
 * well as by the release.
 */
let armedTimer: ReturnType<typeof setTimeout> | undefined;

/** Longer than any press a human holds before the browser ends the gesture. */
const MAX_ARMED_MS = 5_000;

/**
 * One press raises at most one menu, so suppression is spent on use. The
 * release disarms too, which is what keeps a keyboard-invoked menu
 * (Context-Menu key / Shift+F10) raised later from inheriting a press that is
 * long over. Deliberately keyed to `pointerup` and not to `pointercancel`: on
 * Android the browser — and react-aria's own long-press timer — can cancel the
 * pointer before the `contextmenu` it raised arrives, which would race the
 * suppression away.
 */
function suppressContextMenu(event: Event): void {
	event.preventDefault();
	disarm();
}

function disarm(): void {
	if (armedTimer === undefined) return;
	clearTimeout(armedTimer);
	armedTimer = undefined;
	document.removeEventListener("contextmenu", suppressContextMenu, true);
	document.removeEventListener("pointerup", disarm, true);
}

function arm(): void {
	if (armedTimer === undefined) {
		document.addEventListener("contextmenu", suppressContextMenu, true);
		document.addEventListener("pointerup", disarm, true);
	} else {
		clearTimeout(armedTimer);
	}
	armedTimer = setTimeout(disarm, MAX_ARMED_MS);
}

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
 * The `contextmenu` suppression is armed by a touch or pen `pointerdown` and
 * runs on the document in the capture phase: a touch press suppresses the menu
 * Android Chrome and iOS Safari raise on a long press over a link, while a mouse
 * right-click is left alone so the desktop context menu keeps working. Two
 * reasons it is neither react-aria's own suppression nor a handler on the row.
 * react-aria's listener is transient — added on press start, scoped to the
 * touched node, torn down shortly after pointerup — so a press ended early by
 * the swipe gesture's axis arbitration slips past it. And the row itself does
 * not survive the press: the long press enters selection mode, which replaces
 * the swipeable row with the plain one while the finger is still down, so a
 * handler bound to the pressed node is gone by the time the menu arrives.
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

	// Only a touch or pen press arms it: a mouse right-click, and a keyboard menu
	// (Context-Menu key / Shift+F10) that is preceded by no press at all, keep
	// the native menu.
	const onPointerDown = useCallback((event: PointerEvent) => {
		if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
		arm();
	}, []);

	return {
		longPressProps: mergeProps(longPressProps, { onPointerDown }),
	};
}
