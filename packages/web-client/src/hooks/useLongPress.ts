import { useCallback, useRef } from "react";

interface UseLongPressOptions {
	onLongPress: () => void;
	delayMs?: number;
}

interface LongPressHandlers {
	onPointerDown: (e: PointerEvent | React.PointerEvent) => void;
	onPointerMove: (e: PointerEvent | React.PointerEvent) => void;
	onPointerUp: () => void;
	onPointerCancel: () => void;
}

const MOVEMENT_THRESHOLD = 8; // pixels

/**
 * Hook for detecting long-press gestures on touch/pointer devices.
 *
 * @param onLongPress - Callback fired after the delay if the pointer hasn't moved
 * @param delayMs - How long to wait before firing (default 500ms)
 *
 * @returns Pointer event handlers to spread onto your element
 *
 * @example
 * const { handlers } = useLongPress({ onLongPress: () => console.log('long press!') });
 * return <div {...handlers}>Press and hold me</div>;
 */
export const useLongPress = ({
	onLongPress,
	delayMs = 500,
}: UseLongPressOptions): { handlers: LongPressHandlers } => {
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const startPosRef = useRef<{ x: number; y: number } | null>(null);

	const clearTimer = useCallback(() => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		startPosRef.current = null;
	}, []);

	const onPointerDown = useCallback(
		(e: PointerEvent | React.PointerEvent) => {
			clearTimer();
			startPosRef.current = { x: e.clientX, y: e.clientY };
			timerRef.current = setTimeout(() => {
				onLongPress();
				clearTimer();
			}, delayMs);
		},
		[onLongPress, delayMs, clearTimer],
	);

	const onPointerMove = useCallback(
		(e: PointerEvent | React.PointerEvent) => {
			if (!startPosRef.current) return;

			const dx = e.clientX - startPosRef.current.x;
			const dy = e.clientY - startPosRef.current.y;
			const distance = Math.sqrt(dx * dx + dy * dy);

			if (distance > MOVEMENT_THRESHOLD) {
				clearTimer();
			}
		},
		[clearTimer],
	);

	const onPointerUp = useCallback(() => {
		clearTimer();
	}, [clearTimer]);

	const onPointerCancel = useCallback(() => {
		clearTimer();
	}, [clearTimer]);

	return {
		handlers: {
			onPointerDown,
			onPointerMove,
			onPointerUp,
			onPointerCancel,
		},
	};
};
