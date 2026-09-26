import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

export interface PaneHeaderProps {
	title?: string;
	leading?: ReactNode;
	children?: ReactNode;
	className?: string;
}

export function PaneHeader({
	title,
	leading,
	children,
	className,
}: PaneHeaderProps) {
	return (
		<header
			className={cn(
				"flex h-pane-header shrink-0 items-center gap-2 border-b border-line px-row-inset",
				className,
			)}
		>
			{leading}
			{title !== undefined && (
				<h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
					{title}
				</h1>
			)}
			{children}
		</header>
	);
}
