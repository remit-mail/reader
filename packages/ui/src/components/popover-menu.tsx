import { EllipsisVertical } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn.js";
import { Button } from "./button.js";

export interface PopoverMenuItem {
	/** Stable key, also the accessible text of the row. */
	key: string;
	label: string;
	icon?: ReactNode;
	onSelect: () => void;
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

	useEffect(() => {
		if (!open) return;
		const onPointer = (event: MouseEvent) => {
			if (
				containerRef.current &&
				!containerRef.current.contains(event.target as Node)
			) {
				setOpen(false);
			}
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", onPointer);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onPointer);
			document.removeEventListener("keydown", onKey);
		};
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
			{open && (
				<div
					role="menu"
					className={cn(
						"absolute top-full z-50 mt-1 flex max-h-[60dvh] min-w-44 flex-col overflow-y-auto overscroll-contain rounded-md border border-line bg-surface py-1 shadow-lg",
						align === "end" ? "right-0" : "left-0",
					)}
				>
					{items.map((item) => (
						<button
							key={item.key}
							type="button"
							role="menuitem"
							onClick={() => {
								setOpen(false);
								item.onSelect();
							}}
							className="flex min-h-11 items-center gap-3 px-4 py-2.5 text-left text-sm text-fg transition-colors hover:bg-surface-sunken"
						>
							{item.icon && (
								<span className="shrink-0 text-fg-subtle">{item.icon}</span>
							)}
							{item.label}
						</button>
					))}
					{children}
				</div>
			)}
		</div>
	);
}
