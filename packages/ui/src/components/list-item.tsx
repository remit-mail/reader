import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn.js";

export interface ListItemProps extends HTMLAttributes<HTMLDivElement> {
	leading?: ReactNode;
	trailing?: ReactNode;
	active?: boolean;
	unread?: boolean;
}

export function ListItem({
	leading,
	trailing,
	active,
	unread,
	className,
	children,
	...props
}: ListItemProps) {
	return (
		<div
			className={cn(
				"group relative flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors",
				active ? "bg-accent-soft" : "hover:bg-surface-sunken",
				className,
			)}
			{...props}
		>
			{unread && (
				<span className="absolute left-1.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-accent" />
			)}
			{leading && <div className="shrink-0 pt-0.5">{leading}</div>}
			<div className="min-w-0 flex-1">{children}</div>
			{trailing && (
				<div className="shrink-0 text-2xs text-fg-subtle">{trailing}</div>
			)}
		</div>
	);
}
