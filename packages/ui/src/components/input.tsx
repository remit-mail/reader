import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "../lib/cn.js";

export type InputVariant = "default" | "inline";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
	/** Optional leading icon (lucide-react element). */
	icon?: ReactNode;
	/**
	 * `default` renders the boxed field (border, sunken surface, focus ring).
	 * `inline` is a borderless, transparent field for inline filter/search
	 * rows where the surrounding container owns the chrome.
	 */
	variant?: InputVariant;
	/** Forwarded to the underlying `<input>`. */
	ref?: Ref<HTMLInputElement>;
}

const wrapperVariants: Record<InputVariant, string> = {
	default: cn(
		"flex h-9 items-center gap-2 rounded-md border border-line bg-surface-sunken px-3 text-sm",
		"focus-within:border-line-strong focus-within:ring-2 focus-within:ring-ring/30 transition-colors",
	),
	inline: "flex items-center gap-2 bg-transparent text-sm",
};

export function Input({
	icon,
	className,
	variant = "default",
	ref,
	...props
}: InputProps) {
	return (
		<div className={cn(wrapperVariants[variant], className)}>
			{icon && <span className="text-fg-subtle shrink-0">{icon}</span>}
			<input
				ref={ref}
				className="min-w-0 flex-1 bg-transparent text-fg placeholder:text-fg-subtle outline-none"
				{...props}
			/>
		</div>
	);
}
