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
	items: PopoverMenuItem[];
	/** Which edge the menu aligns to. Defaults to "end" (right). */
	align?: "start" | "end";
	/** Touch-sizes the trigger to ≥44px. Defaults to true. */
	touch?: boolean;
	className?: string;
}

/**
 * A small touch dropdown menu: a kebab trigger over a list of action rows,
 * dismissed on outside-click or Escape. Built on the kit `Button` for the
 * trigger; rows are ≥44px for touch ergonomics. The home for the secondary
 * actions an overflow menu collects (mark read/unread, …) so the live client
 * stops hand-rolling the same popover. Renders nothing when `items` is empty —
 * an empty kebab is dead weight, not a disabled control.
 */
export function PopoverMenu({
	triggerLabel,
	triggerIcon,
	items,
	align = "end",
	touch = true,
	className,
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

	if (items.length === 0) return null;

	return (
		<div ref={containerRef} className={cn("relative", className)}>
			<Button
				variant="ghost"
				size="sm"
				icon={triggerIcon ?? <EllipsisVertical className="size-5" />}
				onClick={() => setOpen((value) => !value)}
				aria-label={triggerLabel}
				aria-haspopup="menu"
				aria-expanded={open}
				className={cn(touch && "min-h-11 min-w-11 px-0")}
			/>
			{open && (
				<div
					role="menu"
					className={cn(
						"absolute top-full z-50 mt-1 flex min-w-44 flex-col rounded-md border border-line bg-surface py-1 shadow-lg",
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
				</div>
			)}
		</div>
	);
}
