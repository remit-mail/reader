import { type FullGestureState, useDrag } from "@use-gesture/react";
import type { HTMLAttributes, PointerEvent } from "react";
import { mergeProps } from "react-aria";

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
 * Android the browser can cancel the
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

export const LONG_PRESS_DELAY_MS = 500;

export const LONG_PRESS_DRIFT_PX = 36;

export interface UseLongPressOptions {
	onLongPress: () => void;
	isDisabled?: boolean;
	delayMs?: number;
	accessibilityDescription?: string;
}

export interface UseLongPressResult {
	longPressProps: HTMLAttributes<HTMLElement>;
}

export const holdConfig = (delayMs: number) =>
	({
		delay: delayMs,
		threshold: LONG_PRESS_DRIFT_PX,
		triggerAllEvents: true,
		pointer: { keys: false },
	}) as const;

export const isHold = (state: FullGestureState<"drag">): boolean =>
	state.event.type === "pointerdown" && state.first;

export const touchMenuSuppressionProps = {
	onPointerDown: (event: PointerEvent) => {
		if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
		arm();
	},
};

export function useLongPress({
	onLongPress,
	isDisabled,
	delayMs = LONG_PRESS_DELAY_MS,
	accessibilityDescription,
}: UseLongPressOptions): UseLongPressResult {
	const bind = useDrag(
		(state) => {
			if (isHold(state)) onLongPress();
		},
		{ ...holdConfig(delayMs), enabled: !isDisabled },
	);

	return {
		longPressProps: mergeProps(bind(), touchMenuSuppressionProps, {
			"aria-description": accessibilityDescription,
		}),
	};
}
