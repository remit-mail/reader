import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface DropdownMenuProps {
	trigger: React.ReactNode;
	children: React.ReactNode;
	align?: "left" | "right";
}

export const DropdownMenu = ({
	trigger,
	children,
	align = "right",
}: DropdownMenuProps) => {
	const [isOpen, setIsOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	const handleClickOutside = useCallback((event: MouseEvent) => {
		if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
			setIsOpen(false);
		}
	}, []);

	const handleKeyDown = useCallback((event: KeyboardEvent) => {
		if (event.key === "Escape") {
			setIsOpen(false);
		}
	}, []);

	useEffect(() => {
		if (isOpen) {
			document.addEventListener("mousedown", handleClickOutside);
			document.addEventListener("keydown", handleKeyDown);
		}
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [isOpen, handleClickOutside, handleKeyDown]);

	return (
		<div ref={menuRef} className="relative">
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					setIsOpen(!isOpen);
				}}
				className={cn(
					"p-1.5 min-h-11 min-w-11 inline-flex items-center justify-center rounded-md transition-colors",
					"hover:bg-surface-raised text-fg-muted hover:text-fg",
				)}
			>
				{trigger}
			</button>
			{isOpen && (
				<div
					className={cn(
						"absolute z-50 mt-1 min-w-[180px] py-1",
						"bg-surface border border-line rounded-md shadow-lg",
						align === "right" ? "right-0" : "left-0",
					)}
				>
					{children}
				</div>
			)}
		</div>
	);
};

interface DropdownMenuItemProps {
	onClick: () => void;
	disabled?: boolean;
	destructive?: boolean;
	children: React.ReactNode;
}

export const DropdownMenuItem = ({
	onClick,
	disabled,
	destructive,
	children,
}: DropdownMenuItemProps) => (
	<button
		type="button"
		onClick={(e) => {
			e.stopPropagation();
			if (!disabled) onClick();
		}}
		disabled={disabled}
		className={cn(
			"w-full px-3 py-2 text-left text-sm transition-colors",
			"flex items-center gap-2",
			disabled && "opacity-50 cursor-not-allowed",
			!disabled && "hover:bg-surface-raised",
			destructive && "text-danger hover:text-danger",
		)}
	>
		{children}
	</button>
);

export const DropdownMenuSeparator = () => (
	<div className="my-1 h-px bg-line" />
);
