import {
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn.js";

export interface AnchoredOverlayProps {
	/** The element the panel hangs off. Null until the trigger has mounted. */
	anchor: HTMLElement | null;
	open: boolean;
	/** Outside press or Escape. */
	onDismiss: () => void;
	/** Which edge of the anchor the panel lines up with. Defaults to "end". */
	align?: "start" | "end";
	/** The panel's own height ceiling, further clamped to the room on screen. */
	maxHeight?: number;
	id?: string;
	className?: string;
	children: ReactNode;
}

interface Placement {
	top: number;
	left: number;
	maxHeight: number;
}

const GAP = 4;
const EDGE = 8;

const place = (
	anchor: HTMLElement,
	panel: HTMLElement,
	align: "start" | "end",
	ceiling: number | undefined,
): Placement => {
	const rect = anchor.getBoundingClientRect();
	const width = panel.offsetWidth;
	const preferred = align === "end" ? rect.right - width : rect.left;
	const left = Math.max(
		EDGE,
		Math.min(preferred, window.innerWidth - width - EDGE),
	);

	const below = window.innerHeight - rect.bottom - GAP - EDGE;
	const above = rect.top - GAP - EDGE;
	const height = Math.min(
		ceiling ?? Number.POSITIVE_INFINITY,
		panel.offsetHeight,
	);
	if (below >= height || below >= above) {
		return {
			top: rect.bottom + GAP,
			left,
			maxHeight: Math.min(ceiling ?? below, below),
		};
	}
	return {
		top: Math.max(EDGE, rect.top - GAP - Math.min(ceiling ?? above, above)),
		left,
		maxHeight: Math.min(ceiling ?? above, above),
	};
};

/**
 * A panel that hangs off a trigger and is drawn on the page rather than inside
 * it.
 *
 * The panes of the shell are `overflow: hidden` — that is what keeps a pane's
 * content from resizing it — so a panel positioned inside one is cut off at the
 * pane's edge, and a taller stacking context next door draws over what is left.
 * Portalling to the document and positioning against the trigger's viewport
 * rect is what lets a dropdown open over the neighbouring pane the way it
 * reads on screen (#601).
 *
 * Dismissal is the popover contract: a press anywhere outside the panel and its
 * trigger, or Escape.
 */
export function AnchoredOverlay({
	anchor,
	open,
	onDismiss,
	align = "end",
	maxHeight,
	id,
	className,
	children,
}: AnchoredOverlayProps) {
	const panelRef = useRef<HTMLDivElement>(null);
	const [placement, setPlacement] = useState<Placement | null>(null);

	const reposition = useCallback(() => {
		const panel = panelRef.current;
		if (!anchor || !panel) return;
		setPlacement(place(anchor, panel, align, maxHeight));
	}, [anchor, align, maxHeight]);

	useLayoutEffect(() => {
		if (!open) {
			setPlacement(null);
			return;
		}
		reposition();
	}, [open, reposition]);

	useEffect(() => {
		if (!open) return;
		const onPress = (event: MouseEvent) => {
			const target = event.target as Node;
			if (panelRef.current?.contains(target)) return;
			if (anchor?.contains(target)) return;
			onDismiss();
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onDismiss();
		};
		// Capture: a scroll anywhere between the trigger and the document moves
		// the anchor, and scroll does not bubble.
		window.addEventListener("scroll", reposition, true);
		window.addEventListener("resize", reposition);
		document.addEventListener("mousedown", onPress);
		document.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("scroll", reposition, true);
			window.removeEventListener("resize", reposition);
			document.removeEventListener("mousedown", onPress);
			document.removeEventListener("keydown", onKey);
		};
	}, [open, anchor, onDismiss, reposition]);

	if (!open || typeof document === "undefined") return null;

	return createPortal(
		<div
			ref={panelRef}
			id={id}
			style={
				placement
					? {
							top: placement.top,
							left: placement.left,
							maxHeight: placement.maxHeight,
						}
					: { top: 0, left: 0, visibility: "hidden" }
			}
			className={cn("fixed z-50", className)}
		>
			{children}
		</div>,
		document.body,
	);
}
