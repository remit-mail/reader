import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

export type KbdProps = HTMLAttributes<HTMLElement>;

/** Inline keyboard-key hint — keyboard-first UI surfaces these everywhere. */
export function Kbd({ className, ...props }: KbdProps) {
	return (
		<kbd
			className={cn(
				"inline-flex h-4 min-w-4 items-center justify-center rounded-xs border border-line bg-surface-sunken px-1 font-sans text-2xs text-fg-muted",
				className,
			)}
			{...props}
		/>
	);
}
