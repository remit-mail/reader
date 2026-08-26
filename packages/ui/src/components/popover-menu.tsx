import { EllipsisVertical } from "lucide-react";
import type { CSSProperties, Ref, RefObject } from "react";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn.js";
import { useOverlayScope } from "../lib/overlay-scope.js";
import { Button } from "./button.js";

/** Viewport-relative bounding box of whatever a menu opens against. */
export interface PopoverMenuAnchor {
	readonly left: number;
	readonly right: number;
	readonly top: number;
	readonly bottom: number;
}

const ANCHOR_GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;

/**
 * Where the panel lands: below the anchor and aligned to whichever edge
 * `align` names, pulled back onto the screen on every side it would
 * otherwise cross. A panel too tall for the space below flips above the
 * anchor instead of running past the bottom edge.
 */
function clampToViewport(
	anchor: PopoverMenuAnchor,
	panel: { width: number; height: number },
	align: "start" | "end",
): { left: number; top: number } {
	const maxLeft = Math.max(
		VIEWPORT_MARGIN_PX,
		window.innerWidth - panel.width - VIEWPORT_MARGIN_PX,
	);
	const preferredLeft =
		align === "end" ? anchor.right - panel.width : anchor.left;
	const left = Math.min(Math.max(preferredLeft, VIEWPORT_MARGIN_PX), maxLeft);

	const below = anchor.bottom + ANCHOR_GAP_PX;
	const above = anchor.top - ANCHOR_GAP_PX - panel.height;
	const fitsBelow =
		below + panel.height <= window.innerHeight - VIEWPORT_MARGIN_PX;
	const top = fitsBelow || above < VIEWPORT_MARGIN_PX ? below : above;

	return { left, top };
}

/**
 * Measures the anchor and the panel's own size, then keeps the panel's fixed
 * position clamped to the viewport for as long as it is open — reset on every
 * resize, on scroll anywhere in the ancestor chain (a fixed position does not
 * follow a scrolled anchor on its own), and whenever the panel's own box
 * changes. A panel placed once at the size it opened with runs off the bottom
 * as soon as its content arrives: a loading line gives way to a full list, a
 * confirmation bar appears on a pick, a filter shrinks it back.
 */
function useAnchoredPlacement(
	panelRef: RefObject<HTMLElement | null>,
	open: boolean,
	align: "start" | "end",
	getAnchor: () => PopoverMenuAnchor | null,
): CSSProperties | null {
	const [style, setStyle] = useState<CSSProperties | null>(null);
	const getAnchorRef = useRef(getAnchor);
	getAnchorRef.current = getAnchor;

	useLayoutEffect(() => {
		if (!open) {
			setStyle(null);
			return;
		}
		const place = () => {
			const panel = panelRef.current;
			const anchor = getAnchorRef.current();
			if (!panel || !anchor) return;
			// `.width`/`.height` over the rect's own edges: a `getBoundingClientRect`
			// stand-in in a test carries the edges without the derived pair.
			const rect = panel.getBoundingClientRect();
			const size = {
				width: rect.right - rect.left,
				height: rect.bottom - rect.top,
			};
			const placement = clampToViewport(anchor, size, align);
			setStyle((previous) =>
				previous?.left === placement.left && previous.top === placement.top
					? previous
					: { position: "fixed", left: placement.left, top: placement.top },
			);
		};
		place();
		window.addEventListener("resize", place);
		window.addEventListener("scroll", place, true);
		const panel = panelRef.current;
		let observer: ResizeObserver | null = null;
		if (panel && typeof ResizeObserver !== "undefined") {
			observer = new ResizeObserver(place);
			observer.observe(panel);
		}
		return () => {
			observer?.disconnect();
			window.removeEventListener("resize", place);
			window.removeEventListener("scroll", place, true);
		};
	}, [open, align, panelRef]);

	return style;
}

export interface PopoverMenuPortalProps {
	open: boolean;
	align?: "start" | "end";
	getAnchor: () => PopoverMenuAnchor | null;
	panelRef: RefObject<HTMLElement | null>;
	children: ReactNode;
}

/**
 * Carries a menu panel out of the DOM subtree it opened from and into the
 * document body, positioned at a fixed, viewport-clamped point. A panel left
 * in place is clipped by the first scrolling ancestor between it and the
 * page — the compose body, a card, anything with its own `overflow` — no
 * matter how high its `z-index` climbs; escaping that ancestor takes leaving
 * its DOM subtree, which only a portal does.
 *
 * The wrapper carries the menu layer's own `z-50`: as a body child it would
 * otherwise stack by document order alone and lose to every fixed surface
 * already on the page. `z-[60]` stays above it, for confirmation dialogs and
 * error banners that must cover an open menu.
 */
export function PopoverMenuPortal({
	open,
	align = "start",
	getAnchor,
	panelRef,
	children,
}: PopoverMenuPortalProps) {
	const style = useAnchoredPlacement(panelRef, open, align, getAnchor);
	if (!open) return null;
	return createPortal(
		<div
			className="z-50"
			style={style ?? { position: "fixed", visibility: "hidden" }}
		>
			{children}
		</div>,
		document.body,
	);
}

export interface PopoverMenuItem {
	/** Stable key, also the accessible text of the row. */
	key: string;
	label: string;
	icon?: ReactNode;
	onSelect: () => void;
}

export interface PopoverMenuPanelProps {
	label?: string;
	children: ReactNode;
	className?: string;
	ref?: Ref<HTMLDivElement>;
	onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
	"data-testid"?: string;
}

/**
 * The menu itself, without a trigger: the surface, the scrolling and the
 * rounding every dropdown in the kit shares. A menu that hangs off a button
 * gets it through {@link PopoverMenu}; one anchored to something else — the
 * misspelt word under the pointer — positions this and keeps the same chrome.
 */
export function PopoverMenuPanel({
	label,
	children,
	className,
	ref,
	onKeyDown,
	"data-testid": testId,
}: PopoverMenuPanelProps) {
	return (
		<div
			ref={ref}
			role="menu"
			aria-label={label}
			tabIndex={-1}
			onKeyDown={onKeyDown}
			data-testid={testId}
			className={cn(
				"z-50 flex max-h-[60dvh] min-w-44 flex-col overflow-y-auto overscroll-contain rounded-md border border-line bg-surface py-1 shadow-lg outline-none",
				className,
			)}
		>
			{children}
		</div>
	);
}

export interface PopoverMenuRowProps {
	label: string;
	icon?: ReactNode;
	onSelect: () => void;
	className?: string;
	lang?: string;
	"data-testid"?: string;
}

/** One selectable row of a menu panel, at the kit's touch height. */
export function PopoverMenuRow({
	label,
	icon,
	onSelect,
	className,
	lang,
	"data-testid": testId,
}: PopoverMenuRowProps) {
	return (
		<button
			type="button"
			role="menuitem"
			lang={lang}
			onClick={onSelect}
			data-testid={testId}
			className={cn(
				"flex min-h-11 items-center gap-3 px-4 py-2.5 text-left text-sm text-fg transition-colors hover:bg-surface-sunken",
				className,
			)}
		>
			{icon && <span className="shrink-0 text-fg-subtle">{icon}</span>}
			{label}
		</button>
	);
}

export interface PopoverMenuProps {
	/** Accessible label for the trigger button. */
	triggerLabel: string;
	/** Trigger glyph. Defaults to the vertical ellipsis (kebab). */
	triggerIcon?: ReactNode;
	/** Visible trigger text. Without it the trigger is the glyph alone. */
	triggerText?: string;
	items: PopoverMenuItem[];
	/** Which edge the menu aligns to. Defaults to "end" (right). */
	align?: "start" | "end";
	/** Touch-sizes the trigger to ≥44px. Defaults to true. */
	touch?: boolean;
	className?: string;
	triggerClassName?: string;
	/**
	 * This menu is itself a row of an enclosing menu: the trigger becomes a
	 * `menuitem` and its wrapper drops out of the accessibility tree, so the
	 * enclosing `menu` holds only menu children.
	 */
	nested?: boolean;
	/**
	 * Extra rows below the items — a nested trigger whose own list is too long
	 * or too dynamic to flatten into `items`, e.g. the label picker. Present
	 * children keep the menu alive even with no items of its own.
	 */
	children?: ReactNode;
}

/**
 * A small touch dropdown menu: a kebab trigger over a list of action rows,
 * dismissed on outside-click or Escape. Built on the kit `Button` for the
 * trigger; rows are ≥44px for touch ergonomics. The home for the secondary
 * actions an overflow menu collects (mark read/unread, …) so the live client
 * stops hand-rolling the same popover. Renders nothing when there are no items
 * and no children — an empty kebab is dead weight, not a disabled control, so
 * a caller passing `children` owes it something to show.
 *
 * The panel scrolls within the viewport: a list as long as an account's labels
 * would otherwise run off the bottom of a phone with no way to reach its end.
 */
export function PopoverMenu({
	triggerLabel,
	triggerIcon,
	triggerText,
	items,
	align = "end",
	touch = true,
	className,
	triggerClassName,
	nested = false,
	children,
}: PopoverMenuProps) {
	const [open, setOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);

	useOverlayScope({
		id: "popover-menu",
		open,
		handlers: { back: () => setOpen(false) },
	});

	useEffect(() => {
		if (!open) return;
		const onPointer = (event: MouseEvent) => {
			const target = event.target as Node;
			if (
				containerRef.current?.contains(target) ||
				panelRef.current?.contains(target)
			)
				return;
			setOpen(false);
		};
		document.addEventListener("mousedown", onPointer);
		return () => document.removeEventListener("mousedown", onPointer);
	}, [open]);

	if (items.length === 0 && !children) return null;

	return (
		<div
			ref={containerRef}
			className={cn("relative", className)}
			{...(nested ? { role: "none" } : {})}
		>
			<Button
				variant="ghost"
				size="sm"
				icon={triggerIcon ?? <EllipsisVertical className="size-5" />}
				onClick={() => setOpen((value) => !value)}
				aria-label={triggerLabel}
				aria-haspopup="menu"
				aria-expanded={open}
				{...(nested ? { role: "menuitem" } : {})}
				className={cn(touch && "min-h-11 min-w-11 px-0", triggerClassName)}
			>
				{triggerText}
			</Button>
			<PopoverMenuPortal
				open={open}
				align={align}
				panelRef={panelRef}
				getAnchor={() => containerRef.current?.getBoundingClientRect() ?? null}
			>
				<PopoverMenuPanel ref={panelRef}>
					{items.map((item) => (
						<PopoverMenuRow
							key={item.key}
							label={item.label}
							icon={item.icon}
							onSelect={() => {
								setOpen(false);
								item.onSelect();
							}}
						/>
					))}
					{children}
				</PopoverMenuPanel>
			</PopoverMenuPortal>
		</div>
	);
}
