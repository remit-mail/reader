import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

type Tone = "neutral" | "accent" | "positive" | "warning" | "danger";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
	tone?: Tone;
	/** Render as a small filled dot + label instead of a pill. */
	dot?: boolean;
}

const tones: Record<Tone, string> = {
	neutral: "bg-surface-sunken text-fg-muted",
	// informational chips ride the cyan secondary accent
	accent: "bg-accent-2-soft text-accent-2",
	positive: "bg-surface-sunken text-positive",
	warning: "bg-surface-sunken text-warning",
	danger: "bg-danger-soft text-danger",
};

const dotColors: Record<Tone, string> = {
	neutral: "bg-fg-subtle",
	accent: "bg-accent-2",
	positive: "bg-positive",
	warning: "bg-warning",
	danger: "bg-danger",
};

export function Badge({
	tone = "neutral",
	dot,
	className,
	children,
	...props
}: BadgeProps) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-2xs font-medium",
				tones[tone],
				className,
			)}
			{...props}
		>
			{dot && <span className={cn("size-1.5 rounded-full", dotColors[tone])} />}
			{children}
		</span>
	);
}
