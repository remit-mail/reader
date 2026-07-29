import { Check, Mail, MailOpen, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { mergeProps } from "react-aria";
import { cn } from "../lib/cn.js";
import { useLongPress } from "../lib/use-long-press.js";
import type { ThreadRowData } from "./app-shell-types.js";
import { Avatar } from "./avatar.js";
import {
	ComfortableRowTextContent,
	comfortableRowClass,
} from "./message-row.js";

export type SwipePeek = "none" | "leading" | "trailing";

/** Width a peeked row settles at to reveal its action; also the drag distance
 *  past which a release commits the peek rather than snapping back. */
const SWIPE_ACTION_WIDTH = 72;
/** Movement (px) before a pointer drag claims an axis; below this a press is
 *  still a tap / long-press and vertical scroll wins. Claiming an axis only
 *  decides what the row tracks — it does not decide the long press. */
const SWIPE_AXIS_THRESHOLD = 10;
/**
 * Movement (px) along the claimed axis before a drag takes the gesture away
 * from a still-pending long press.
 *
 * A finger resting on glass for the 500ms hold drifts, and it drifts further
 * than the axis threshold — that threshold is calibrated for a drag starting
 * to track, which has to feel immediate. Killing the press at that distance
 * meant a real hold read as a swipe: the row followed the drift, the press
 * died, and on release the drift was too short to commit a peek, so the
 * gesture produced nothing at all.
 *
 * The escape distance is the commit distance, so the swipe only takes the
 * gesture once it has moved far enough to actually produce a peek. Below it a
 * release snaps back, which is to say the swipe was never worth the press.
 */
const LONG_PRESS_ESCAPE = SWIPE_ACTION_WIDTH / 2;

/**
 * Tags a pointercancel dispatched by this component's own arbitration (see
 * `cancelLongPress` below) so `onPointerCancel` can tell it apart from one
 * react-aria dispatches itself when its own long press fires, or a genuine
 * browser-triggered cancel. Both of those end the gesture and must reset it
 * silently; a tagged one arrives *because* `onPointerMove`/`onPointerUp` is
 * already handling that gesture inline, so `onPointerCancel` must ignore it —
 * otherwise it drops the drag and the release reads as a tap, firing a
 * spurious onOpen/onToggleCheck.
 */
const AXIS_CANCEL = "__swipeableRowAxisCancel";

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
	const gesture = useRef<{
		startX: number;
		startY: number;
		axis: "none" | "horizontal" | "vertical";
		/** The drag has passed LONG_PRESS_ESCAPE and already cancelled the press. */
		escaped: boolean;
	} | null>(null);
	const [dragX, setDragX] = useState<number | null>(null);

	// Long-press timing/threshold and touch contextmenu suppression are owned
	// by useLongPress; this component only arbitrates the swipe axis.
	const { longPressProps } = useLongPress({
		onLongPress,
		isDisabled: selectionMode,
		accessibilityDescription: "Select message",
	});

	// react-aria's usePress has no imperative "cancel" — a synthetic
	// pointercancel is the mechanism it uses itself to abort other pointer
	// consumers when its own long press fires. Reused here in reverse, tagged
	// so onPointerCancel below can recognize it as ours (see AXIS_CANCEL).
	const cancelLongPress = (e: React.PointerEvent) => {
		const event = new PointerEvent("pointercancel", { bubbles: true });
		(event as PointerEvent & Record<string, boolean>)[AXIS_CANCEL] = true;
		e.currentTarget.dispatchEvent(event);
	};

	const onPointerDown = (e: React.PointerEvent) => {
		gesture.current = {
			startX: e.clientX,
			startY: e.clientY,
			axis: "none",
			escaped: false,
		};
	};

	const onPointerMove = (e: React.PointerEvent) => {
		if (selectionMode) return;
		const g = gesture.current;
		if (!g) return;
		const dx = e.clientX - g.startX;
		const dy = e.clientY - g.startY;
		if (g.axis === "none") {
			if (Math.abs(dy) > SWIPE_AXIS_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
				// vertical scroll wins: stop tracking the swipe, let the list scroll
				g.axis = "vertical";
			} else if (
				Math.abs(dx) > SWIPE_AXIS_THRESHOLD &&
				Math.abs(dx) > Math.abs(dy)
			) {
				g.axis = "horizontal";
				e.currentTarget.setPointerCapture(e.pointerId);
			}
		}
		if (g.axis === "none") return;
		// The drag only takes the gesture from a pending long press once it has
		// travelled the commit distance along the axis it claimed (see
		// LONG_PRESS_ESCAPE). Latched so the cancel is dispatched once.
		const travel = g.axis === "horizontal" ? Math.abs(dx) : Math.abs(dy);
		if (!g.escaped && travel > LONG_PRESS_ESCAPE) {
			g.escaped = true;
			cancelLongPress(e);
		}
		if (g.axis !== "horizontal") return;
		const base = peekOffset(peek);
		const next = Math.max(
			-SWIPE_ACTION_WIDTH,
			Math.min(SWIPE_ACTION_WIDTH, base + dx),
		);
		setDragX(next);
	};

	const onPointerUp = (e: React.PointerEvent) => {
		const g = gesture.current;
		gesture.current = null;
		const offset = dragX;
		setDragX(null);
		// g is null when the gesture was already consumed (the long press fired,
		// or a real cancel arrived) — those handle themselves, so do nothing.
		if (!g) return;
		// A drag that claimed an axis but never escaped left react-aria's press
		// live, and an unresolved press synthesizes a click on release. The drag
		// was neither a swipe nor a tap, so end the press with it.
		if (g.axis !== "none" && !g.escaped) cancelLongPress(e);
		if (g.axis === "horizontal") {
			if (offset !== null) onPeek(commitPeek(offset));
			return;
		}
		// The list scrolled under the finger; the release is not a tap.
		if (g.axis === "vertical") return;
		// a tap: no axis claimed
		if (selectionMode) {
			onToggleCheck();
			return;
		}
		if (peek !== "none") {
			onPeek("none");
			return;
		}
		onOpen();
	};

	// A genuine cancel — react-aria's own dispatch when its long press fires,
	// or a real browser-triggered interruption (the browser taking over the
	// pan, say) — always resets silently, never as a tap-to-open/toggle/peek
	// -commit. This component's own cancel (tagged, see AXIS_CANCEL) is a no-op
	// here: the handler that dispatched it owns that gesture's state.
	const onPointerCancel = (e: React.PointerEvent) => {
		const tagged = (e.nativeEvent as unknown as Record<string, boolean>)[
			AXIS_CANCEL
		];
		if (tagged) return;
		gesture.current = null;
		setDragX(null);
	};

	const gestureProps = mergeProps(longPressProps, {
		onPointerDown,
		onPointerMove,
		onPointerUp,
		onPointerCancel,
	});

	const offset = dragX ?? peekOffset(peek);
	const revealed: SwipePeek =
		offset > 0 ? "leading" : offset < 0 ? "trailing" : "none";

	const interactiveClassName = cn(
		// opaque bg so the row occludes the action behind it until peeked
		"relative touch-pan-y bg-surface",
		// This row's long press enters selection mode; without this, the hold
		// starts a native text selection across the row's subject and snippet.
		"select-none",
		comfortableRowClass({ active: checked || active }),
	);
	const interactiveStyle: React.CSSProperties = {
		transform: offset !== 0 ? `translateX(${offset}px)` : undefined,
		transition: dragX === null ? "transform 150ms ease" : "none",
		minHeight: 44,
	};
	const unread = !thread.isRead;

	// Stops the row's own pointer-gesture handlers (long-press, swipe axis
	// detection) from also firing for a tap that started on the nested avatar
	// toggle — the row and the toggle are two separate controls sharing the
	// same leading 28px slot.
	const stopRowGesture = (e: React.PointerEvent) => e.stopPropagation();

	const body = selectionMode ? (
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
		<>
			{unread && (
				<span className="absolute left-1.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-accent" />
			)}
			{/*
			 * Tappable, focusable entry point into selection mode — long-press is
			 * never the only way in. A span, not a <button>: it sits inside the
			 * row's own open button, which may not nest one. The checkbox role and
			 * label are what the user and the test suite address, so both stay.
			 */}
			{/* biome-ignore lint/a11y/useSemanticElements: a native <input type="checkbox"> can't host the Avatar as its visible content, and a nested <button> inside the row's own button is invalid HTML */}
			<span
				role="checkbox"
				tabIndex={0}
				aria-checked={checked}
				aria-label={`Select message from ${thread.fromName}`}
				onPointerDown={stopRowGesture}
				onPointerMove={stopRowGesture}
				onPointerUp={stopRowGesture}
				onClick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					onLongPress();
				}}
				onKeyDown={(e) => {
					if (e.key !== "Enter" && e.key !== " ") return;
					e.preventDefault();
					e.stopPropagation();
					onLongPress();
				}}
				className="-m-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full"
			>
				<Avatar name={thread.fromName} email={thread.fromEmail} size="sm" />
			</span>
			<ComfortableRowTextContent thread={thread} />
		</>
	);

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

			{/* `data-message-row` is the mail app's row marker: its key dispatcher
			    reads it to tell a row apart from a control nested inside one, and
			    the e2e suite locates rows by it. */}
			{/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is only ever "checkbox" (aria-checked's owning role) when selectionMode is true; the ternaries are linked, biome can't see that statically */}
			<button
				type="button"
				role={selectionMode ? "checkbox" : undefined}
				aria-checked={selectionMode ? checked : undefined}
				data-message-row
				{...gestureProps}
				className={interactiveClassName}
				style={interactiveStyle}
			>
				{body}
			</button>
		</div>
	);
}
