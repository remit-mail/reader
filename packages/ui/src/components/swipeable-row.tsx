import { Check, Mail, MailOpen, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "../lib/cn.js";
import type { ThreadRowData } from "./app-shell-types.js";
import {
	ComfortableRowBody,
	ComfortableRowTextContent,
	comfortableRowClass,
} from "./message-row.js";

export type SwipePeek = "none" | "leading" | "trailing";

/** Width a peeked row settles at to reveal its action; also the drag distance
 *  past which a release commits the peek rather than snapping back. */
const SWIPE_ACTION_WIDTH = 72;
/** Movement (px) before a pointer drag claims the horizontal (swipe) axis; below
 *  this a press is still a tap / long-press and vertical scroll wins. */
const SWIPE_AXIS_THRESHOLD = 10;

function peekOffset(peek: SwipePeek): number {
	if (peek === "leading") return SWIPE_ACTION_WIDTH;
	if (peek === "trailing") return -SWIPE_ACTION_WIDTH;
	return 0;
}

/** Which peek a released drag commits to: past half the action width on a side
 *  settles open to that side, otherwise it snaps back. Pure, so the
 *  drag-release rule is unit-testable without a DOM. */
export function commitPeek(offset: number): SwipePeek {
	if (offset >= SWIPE_ACTION_WIDTH / 2) return "leading";
	if (offset <= -SWIPE_ACTION_WIDTH / 2) return "trailing";
	return "none";
}

export function SwipeableRow({
	thread,
	selectionMode,
	checked,
	active,
	peek,
	onPeek,
	onToggleCheck,
	onLongPress,
	onOpen,
	onAct,
}: {
	thread: ThreadRowData;
	selectionMode: boolean;
	checked: boolean;
	active: boolean;
	peek: SwipePeek;
	onPeek: (next: SwipePeek) => void;
	onToggleCheck: () => void;
	onLongPress: () => void;
	onOpen: () => void;
	/** Tapping a revealed action performs it: "leading" = toggle read,
	 *  "trailing" = delete. */
	onAct: (side: "leading" | "trailing") => void;
}) {
	const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	const gesture = useRef<{
		startX: number;
		startY: number;
		axis: "none" | "horizontal" | "vertical";
		moved: boolean;
	} | null>(null);
	const [dragX, setDragX] = useState<number | null>(null);

	const cancelLongPress = () => clearTimeout(pressTimer.current);

	const onPointerDown = (e: React.PointerEvent) => {
		gesture.current = {
			startX: e.clientX,
			startY: e.clientY,
			axis: "none",
			moved: false,
		};
		// selection mode is tap-to-toggle only — no long-press, no swipe drag
		if (selectionMode) return;
		pressTimer.current = setTimeout(() => {
			gesture.current = null;
			setDragX(null);
			onLongPress();
		}, 500);
	};

	const onPointerMove = (e: React.PointerEvent) => {
		if (selectionMode) return;
		const g = gesture.current;
		if (!g) return;
		const dx = e.clientX - g.startX;
		const dy = e.clientY - g.startY;
		if (g.axis === "none") {
			if (Math.abs(dy) > SWIPE_AXIS_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
				// vertical scroll wins: abandon the swipe + long-press, let the list scroll
				g.axis = "vertical";
				cancelLongPress();
				gesture.current = null;
				return;
			}
			if (Math.abs(dx) > SWIPE_AXIS_THRESHOLD) {
				g.axis = "horizontal";
				g.moved = true;
				cancelLongPress();
				e.currentTarget.setPointerCapture(e.pointerId);
			}
		}
		if (g.axis !== "horizontal") return;
		const base = peekOffset(peek);
		const next = Math.max(
			-SWIPE_ACTION_WIDTH,
			Math.min(SWIPE_ACTION_WIDTH, base + dx),
		);
		setDragX(next);
	};

	const onPointerUp = () => {
		cancelLongPress();
		const g = gesture.current;
		gesture.current = null;
		const offset = dragX;
		setDragX(null);
		// g is null when the gesture was already consumed (long-press fired, or
		// a vertical scroll took over) — those handle themselves, so do nothing.
		if (!g) return;
		if (g.axis === "horizontal" && offset !== null) {
			onPeek(commitPeek(offset));
			return;
		}
		// a tap: no axis claimed
		if (selectionMode) onToggleCheck();
		else if (peek !== "none") onPeek("none");
		else onOpen();
	};

	const offset = dragX ?? peekOffset(peek);
	const revealed: SwipePeek =
		offset > 0 ? "leading" : offset < 0 ? "trailing" : "none";

	return (
		<div className="relative overflow-hidden">
			{revealed === "leading" && (
				<button
					type="button"
					onClick={() => onAct("leading")}
					aria-label={thread.isRead ? "Mark as unread" : "Mark as read"}
					className="absolute inset-y-0 left-0 flex items-center justify-start bg-accent-2 px-6 text-accent-fg"
				>
					{thread.isRead ? (
						<Mail className="size-6" />
					) : (
						<MailOpen className="size-6" />
					)}
				</button>
			)}
			{revealed === "trailing" && (
				<button
					type="button"
					onClick={() => onAct("trailing")}
					aria-label="Delete message"
					className="absolute inset-y-0 right-0 flex items-center justify-end bg-danger px-6 text-canvas"
				>
					<Trash2 className="size-6" />
				</button>
			)}

			<button
				type="button"
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
				// opaque bg so the row occludes the action behind it until peeked
				className={cn(
					"relative touch-pan-y bg-surface",
					comfortableRowClass({ active: checked || active }),
				)}
				style={{
					transform: offset !== 0 ? `translateX(${offset}px)` : undefined,
					transition: dragX === null ? "transform 150ms ease" : "none",
					minHeight: 44,
				}}
			>
				{selectionMode ? (
					<>
						<span
							className={cn(
								"inline-flex size-7 shrink-0 items-center justify-center rounded-full border",
								checked
									? "border-accent bg-accent text-accent-fg"
									: "border-line-strong bg-canvas",
							)}
						>
							{checked && <Check className="size-3.5" />}
						</span>
						<ComfortableRowTextContent thread={thread} />
					</>
				) : (
					<ComfortableRowBody thread={thread} />
				)}
			</button>
		</div>
	);
}
