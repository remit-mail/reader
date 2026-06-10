import { ChevronDown } from "lucide-react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
	/** Optional leading icon (lucide-react element). */
	icon?: ReactNode;
}

/**
 * Native select styled to match Input: same height, hairline border,
 * sunken surface, focus ring. Options render in <option> children.
 */
export function Select({ icon, className, children, ...props }: SelectProps) {
	return (
		<div
			className={cn(
				"relative flex h-9 items-center gap-2 rounded-md border border-line bg-surface-sunken pl-3 text-sm",
				"focus-within:border-line-strong focus-within:ring-2 focus-within:ring-ring/30 transition-colors",
				className,
			)}
		>
			{icon && <span className="shrink-0 text-fg-subtle">{icon}</span>}
			<select
				className="min-w-0 flex-1 appearance-none bg-transparent py-0 pr-8 text-fg outline-none"
				{...props}
			>
				{children}
			</select>
			<ChevronDown className="pointer-events-none absolute right-2.5 size-4 text-fg-subtle" />
		</div>
	);
}
