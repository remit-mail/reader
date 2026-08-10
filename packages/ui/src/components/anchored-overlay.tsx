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

const FOCUSABLE =
	'input, textarea, select, button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

const place = (
	anchor: HTMLElement,
	panel: HTMLElement,
	align: "start" | "end",
	ceiling: number | undefined,
): Placement => {
	const rect = anchor.getBoundingClientRect();
	const preferred =
		align === "end" ? rect.right - panel.offsetWidth : rect.left;
	const left = Math.max(
		EDGE,
		Math.min(preferred, window.innerWidth - panel.offsetWidth - EDGE),
	);

	const below = Math.max(0, window.innerHeight - rect.bottom - GAP - EDGE);
	const above = Math.max(0, rect.top - GAP - EDGE);
	const wanted = Math.min(ceiling ?? panel.offsetHeight, panel.offsetHeight);

	if (wanted <= below || below >= above) {
		return { top: rect.bottom + GAP, left, maxHeight: Math.min(ceiling ?? below, below) };
	}
	// Above: the panel grows upwards from the trigger, so its top moves with the
	// height it will actually take, never with the ceiling it is allowed.
	const height = Math.min(wanted, above);
	return { top: rect.top - GAP - height, left, maxHeight: Math.min(ceiling ?? above, above) };
};

const samePlacement = (a: Placement | null, b: Placement): boolean =>
	a !== null && a.top === b.top && a.left === b.left && a.maxHeight === b.maxHeight;

/**
 * A panel that hangs off a trigger and is drawn on the page rather than inside
 * it.
 *
 * The panes of the shell are `overflow: hidden` — that is what keeps a pane's
 * content from resizing it — so a panel positioned inside one is cut off at the
 * pane's edge and the pane beside it covers what is left. Portalling to the
 * document and positioning against the trigger's viewport rect is what lets a
 * dropdown open over the neighbouring pane the way it reads on screen (#601).
 *
 * The panel is placed after every render while it is open, so a picker that
 * opens on a loading line and then fills with folders is measured at the size
 * it ends up.
 *
 * Dismissal is the popover contract: a press anywhere outside the panel and its
 * trigger, or Escape. Focus moves into the panel on open and back to the
 * trigger on dismissal — out of the document flow, it is otherwise the last
 * thing on the page to tab to.
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
		const next = place(anchor, panel, align, maxHeight);
		setPlacement((current) => (samePlacement(current, next) ? current : next));
	}, [anchor, align, maxHeight]);

	// No dependency list: content that arrives after the panel opened changes
	// where it belongs, and the equality guard keeps that from looping.
	useLayoutEffect(() => {
		if (!open) {
			setPlacement(null);
			return;
		}
		reposition();
	});

	useEffect(() => {
		if (!open) return;
		const panel = panelRef.current;
		const first = panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
		first?.focus();
		return () => {
			if (panel?.contains(document.activeElement)) anchor?.focus();
		};
	}, [open, anchor]);

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
			tabIndex={-1}
			style={
				placement
					? {
							top: placement.top,
							left: placement.left,
							maxHeight: placement.maxHeight,
						}
					: { top: 0, left: 0, visibility: "hidden" }
			}
			className={cn("fixed z-50 outline-none", className)}
		>
			{children}
		</div>,
		document.body,
	);
}
