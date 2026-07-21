import type { DOMAttributes } from "@react-types/shared";
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
/** Movement (px) before a pointer drag claims the horizontal (swipe) axis; below
 *  this a press is still a tap / long-press and vertical scroll wins. */
const SWIPE_AXIS_THRESHOLD = 10;

/**
 * Tags a pointercancel dispatched by this component's own axis arbitration
 * (see `cancelLongPress` below) so `onPointerCancel` can tell it apart from
 * one react-aria dispatches itself when its own long press fires, or a
 * genuine browser-triggered cancel. Both of those arrive with no axis
 * claimed yet and must reset gesture state silently; a tagged one arrives
 * *because* `onPointerMove` just claimed an axis and is already handling
 * gesture state inline, so `onPointerCancel` must ignore it — otherwise it
 * re-reads a gesture with no axis claimed and mistakes the abort for a tap,
 * firing a spurious onOpen/onToggleCheck.
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

/**
 * Props the row's interactive (open) element must receive — the swipe gesture
 * handlers (merged with react-aria's long-press props: pointer handlers,
 * `aria-describedby`, and friends), the transform/transition style, the row
 * body, plus an onClick that suppresses navigation when the row is peeked. A
 * consumer passes `linkComponent` to render these on a real anchor (e.g. a
 * router Link) so the open affordance is a true `<a href>` — keeping
 * open-in-new-tab, middle-click, deep-link and a11y — instead of the default
 * JS-only `<button onOpen>`.
 */
export interface SwipeableRowOpenProps extends DOMAttributes {
	className: string;
	style: React.CSSProperties;
	/** Wire to the anchor's onClick. When the row is peeked it calls
	 *  preventDefault so a tap closes the peek instead of navigating; otherwise
	 *  it is a no-op and the anchor's native navigation proceeds. */
	onOpenClick: (e: { preventDefault: () => void }) => void;
	children: React.ReactNode;
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
	linkComponent,
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
	/** Render the open affordance as a real anchor (router Link / `<a href>`)
	 *  instead of the default `<button onOpen>`. Receives the gesture handlers,
	 *  style, peek-aware onClickCapture and row body to spread onto the anchor.
	 *  When provided, a plain tap navigates via the anchor's native click (so
	 *  deep-link/middle-click work); onOpen is not called for the tap. */
	linkComponent?: (props: SwipeableRowOpenProps) => React.ReactNode;
}) {
	const gesture = useRef<{
		startX: number;
		startY: number;
		axis: "none" | "horizontal" | "vertical";
		moved: boolean;
	} | null>(null);
	const [dragX, setDragX] = useState<number | null>(null);

	// Long-press timing/threshold and contextmenu/text-selection suppression
	// are owned by react-aria; this component only arbitrates the swipe axis.
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
			moved: false,
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
				// vertical scroll wins: abandon the swipe + long-press, let the list scroll
				g.axis = "vertical";
				cancelLongPress(e);
				gesture.current = null;
				return;
			}
			if (Math.abs(dx) > SWIPE_AXIS_THRESHOLD) {
				g.axis = "horizontal";
				g.moved = true;
				cancelLongPress(e);
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
		if (selectionMode) {
			onToggleCheck();
			return;
		}
		if (peek !== "none") {
			onPeek("none");
			return;
		}
		// A real anchor handles the open via its native click — don't double-fire.
		if (linkComponent) return;
		onOpen();
	};

	// A genuine cancel — react-aria's own dispatch when its long press fires,
	// or a real browser-triggered interruption — always resets silently, never
	// as a tap-to-open/toggle/peek-commit. An axis-claim cancel (tagged, see
	// AXIS_CANCEL) is a no-op here: onPointerMove already handled that gesture
	// inline, either continuing to track it (horizontal) or nulling it itself
	// (vertical) — see the comment there.
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

	// A tap on a peeked anchor must close the peek, not navigate; suppress the
	// native click in that case. onPointerUp already snapped it closed.
	const onOpenClick = (e: { preventDefault: () => void }) => {
		if (peek !== "none") e.preventDefault();
	};

	const offset = dragX ?? peekOffset(peek);
	const revealed: SwipePeek =
		offset > 0 ? "leading" : offset < 0 ? "trailing" : "none";

	const interactiveClassName = cn(
		// opaque bg so the row occludes the action behind it until peeked
		"relative touch-pan-y bg-surface",
		// This row's long press enters selection mode; without these, Android
		// Chrome opens the link context menu / starts text selection and iOS
		// Safari fires the callout, racing the app's handler. react-aria
		// suppresses contextmenu/text-selection but not iOS's callout — it
		// fires no cancelable event, so CSS is the only lever.
		"select-none [-webkit-touch-callout:none]",
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
			 * never the only way in. Nested inside the row's own open control
			 * (button or, via linkComponent, an anchor); mirrors the leading-slot
			 * toggle already shipped in the web client's row.
			 */}
			{/* biome-ignore lint/a11y/useSemanticElements: a native <input type="checkbox"> can't host the Avatar as its visible content; role="checkbox" on a button mirrors the row-checkbox pattern already shipped in MessageListItem.tsx */}
			<button
				type="button"
				role="checkbox"
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
				className="-m-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full"
			>
				<Avatar name={thread.fromName} email={thread.fromEmail} size="sm" />
			</button>
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

			{/* In selection mode the row is tap-to-toggle, never a navigation link —
			    keep the button so a checkbox tap can't open a thread. */}
			{linkComponent && !selectionMode ? (
				linkComponent({
					...gestureProps,
					className: interactiveClassName,
					style: interactiveStyle,
					onOpenClick,
					children: body,
				})
			) : (
				// biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is only ever "checkbox" (aria-checked's owning role) when selectionMode is true; the ternaries are linked, biome can't see that statically
				<button
					type="button"
					role={selectionMode ? "checkbox" : undefined}
					aria-checked={selectionMode ? checked : undefined}
					{...gestureProps}
					className={interactiveClassName}
					style={interactiveStyle}
				>
					{body}
				</button>
			)}
		</div>
	);
}
