import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn.js";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
	/** Optional leading icon (lucide-react element). */
	icon?: ReactNode;
}

export function Input({ icon, className, ...props }: InputProps) {
	return (
		<div
			className={cn(
				"flex h-9 items-center gap-2 rounded-md border border-line bg-surface-sunken px-3 text-sm",
				"focus-within:border-line-strong focus-within:ring-2 focus-within:ring-ring/30 transition-colors",
				className,
			)}
		>
			{icon && <span className="text-fg-subtle shrink-0">{icon}</span>}
			<input
				className="min-w-0 flex-1 bg-transparent text-fg placeholder:text-fg-subtle outline-none"
				{...props}
			/>
		</div>
	);
}
