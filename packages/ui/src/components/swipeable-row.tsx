import { type FullGestureState, useDrag } from "@use-gesture/react";
import { Check, Mail, MailOpen, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { mergeProps } from "react-aria";
import { cn } from "../lib/cn.js";
import {
	SWIPE_AXIS_THRESHOLD,
	SWIPE_DRAG_CONFIG,
} from "../lib/swipe-config.js";
import {
	holdConfig,
	isHold,
	LONG_PRESS_DELAY_MS,
	swallowReleaseClick,
	touchMenuSuppressionProps,
} from "../lib/use-long-press.js";
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
	const [dragX, setDragX] = useState<number | null>(null);
	const dragOffset = useRef<number | null>(null);
	const held = useRef(false);

	const trackDrag = (offset: number | null) => {
		dragOffset.current = offset;
		setDragX(offset);
	};

	const release = (state: FullGestureState<"drag">) => {
		const offset = dragOffset.current;
		const wasHeld = held.current;
		held.current = false;
		trackDrag(null);
		if (state.event.type.endsWith("cancel") || wasHeld) return;
		if (state.tap) {
			if (selectionMode) {
				onToggleCheck();
				return;
			}
			if (peek !== "none") {
				onPeek("none");
				return;
			}
			onOpen();
			return;
		}
		if (state.axis !== "x" || selectionMode || offset === null) return;
		onPeek(commitPeek(offset));
	};

	const bind = useDrag(
		(state) => {
			if (!state.down) {
				release(state);
				return;
			}
			if (isHold(state)) {
				if (selectionMode) return;
				held.current = true;
				swallowReleaseClick();
				onLongPress();
				return;
			}
			if (!state.intentional) return;
			if (selectionMode || held.current || state.axis !== "x") return;
			const travelled = state.values[0] - state.initial[0];
			trackDrag(
				Math.max(
					-SWIPE_ACTION_WIDTH,
					Math.min(SWIPE_ACTION_WIDTH, peekOffset(peek) + travelled),
				),
			);
		},
		{
			...holdConfig(LONG_PRESS_DELAY_MS),
			tapsThreshold: SWIPE_AXIS_THRESHOLD,
			axisThreshold: SWIPE_DRAG_CONFIG.axisThreshold,
		},
	);

	const gestureProps = mergeProps(bind(), touchMenuSuppressionProps, {
		"aria-description": selectionMode ? undefined : "Select message",
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
				data-message-id={thread.id}
				{...gestureProps}
				className={interactiveClassName}
				style={interactiveStyle}
			>
				{body}
			</button>
		</div>
	);
}
