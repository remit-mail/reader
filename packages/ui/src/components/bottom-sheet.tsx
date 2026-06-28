import type { ReactNode } from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../lib/cn.js";

const SNAP_MS = 320;
const SNAP_EASE = "cubic-bezier(0.32, 0.9, 0.3, 1)";
const FLICK_VELOCITY = 0.5;
const DISMISS_FRACTION = 0.4;
const HEIGHT_FALLBACK = 360;

function rubberBand(overshoot: number): number {
	return Math.sign(overshoot) * Math.sqrt(Math.abs(overshoot)) * 4;
}

export interface BottomSheetProps {
	open: boolean;
	onClose: () => void;
	children: ReactNode;
	/** Accessible label for the drag-to-dismiss scrim and grabber. */
	dismissLabel?: string;
}

/**
 * Native-feeling action sheet that slides up from the bottom of its positioned
 * container. Drag the grabber down (or flick) past ~40% to dismiss; tapping the
 * scrim closes it too. Sits absolutely inside the nearest positioned ancestor,
 * so wrap it in a `relative` container (e.g. a phone frame).
 */
export function BottomSheet({
	open,
	onClose,
	children,
	dismissLabel = "Dismiss",
}: BottomSheetProps) {
	const sheetRef = useRef<HTMLDivElement>(null);
	const [height, setHeight] = useState(HEIGHT_FALLBACK);
	const [drag, setDrag] = useState<number | null>(null);

	useLayoutEffect(() => {
		const el = sheetRef.current;
		if (!el) return;
		const measure = () => setHeight(el.offsetHeight);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const pointer = useRef<{
		startY: number;
		lastY: number;
		lastT: number;
		velocity: number;
		moved: boolean;
	} | null>(null);

	const onPointerDown = useCallback((e: React.PointerEvent) => {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		pointer.current = {
			startY: e.clientY,
			lastY: e.clientY,
			lastT: e.timeStamp,
			velocity: 0,
			moved: false,
		};
		setDrag(0);
	}, []);

	const onPointerMove = useCallback((e: React.PointerEvent) => {
		const p = pointer.current;
		if (!p) return;
		const dt = e.timeStamp - p.lastT;
		if (dt > 0) p.velocity = (e.clientY - p.lastY) / dt;
		p.lastY = e.clientY;
		p.lastT = e.timeStamp;

		const delta = e.clientY - p.startY;
		if (Math.abs(delta) > 4) p.moved = true;
		const next = delta < 0 ? rubberBand(delta) : delta;
		setDrag(next);
	}, []);

	const finishDrag = useCallback(() => {
		const p = pointer.current;
		pointer.current = null;
		if (!p) return;
		const delta = p.lastY - p.startY;
		const flick = p.velocity > FLICK_VELOCITY;
		const dismiss = flick || delta > height * DISMISS_FRACTION;
		setDrag(null);
		if (dismiss) onClose();
	}, [height, onClose]);

	const dragging = drag !== null;
	const offset = open ? (drag ?? 0) : height;
	const openness = Math.min(Math.max(1 - offset / height, 0), 1);
	const transition = dragging ? "none" : `transform ${SNAP_MS}ms ${SNAP_EASE}`;

	return (
		<div
			className={cn(
				"absolute inset-0 z-40 select-none overflow-hidden",
				open || dragging ? "" : "pointer-events-none",
			)}
		>
			<button
				type="button"
				aria-label={dismissLabel}
				tabIndex={-1}
				onClick={onClose}
				className={cn(
					"absolute inset-0 bg-black/40",
					openness > 0 ? "pointer-events-auto" : "pointer-events-none",
				)}
				style={{
					opacity: openness * 0.6,
					transition: transition.replace("transform", "opacity"),
				}}
			/>
			<div
				ref={sheetRef}
				className="absolute inset-x-0 bottom-0 flex max-h-[92%] flex-col rounded-t-3xl border-t border-line bg-surface shadow-2xl shadow-black/30"
				style={{ transform: `translateY(${offset}px)`, transition }}
			>
				<div
					role="slider"
					aria-label="Drag down to dismiss"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={Math.round(openness * 100)}
					tabIndex={0}
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={finishDrag}
					onPointerCancel={finishDrag}
					className="flex cursor-grab touch-none justify-center pb-1 pt-2.5 active:cursor-grabbing"
				>
					<div className="h-1 w-10 rounded-full bg-fg-subtle/40" />
				</div>
				<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
					{children}
				</div>
			</div>
		</div>
	);
}
